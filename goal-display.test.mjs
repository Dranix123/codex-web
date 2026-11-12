import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function showGoal('),source.indexOf('setInterval(updateGoalTime'));
function fixture(){const nodes={goalBar:{hidden:true},goalState:{},goalObjective:{},goalTime:{}};const ctx=vm.createContext({$:id=>nodes[id],currentGoal:null,Date:{now:()=>120000}});vm.runInContext(code,ctx);return {nodes,run:code=>vm.runInContext(code,ctx)};}
test('Goal 展示来自原生状态，活跃时累加秒数，暂停后冻结累计时间',()=>{
 const {nodes,run}=fixture();run('showGoal({objective:"目标",status:"active",timeUsedSeconds:65,updatedAt:110})');
 assert.equal(nodes.goalBar.hidden,false);assert.equal(nodes.goalObjective.textContent,'目标');assert.equal(nodes.goalTime.textContent,'1 分 15 秒');
 run('showGoal({objective:"目标",status:"paused",timeUsedSeconds:75,updatedAt:110})');assert.equal(nodes.goalState.textContent,'目标已暂停');assert.equal(nodes.goalTime.textContent,'1 分 15 秒');
 run('showGoal(null)');assert.equal(nodes.goalBar.hidden,true);
});
test('Goal 显示小时与终态，时钟偏差不会产生负数',()=>{
 const {nodes,run}=fixture();run('showGoal({objective:"完成",status:"complete",timeUsedSeconds:3661,updatedAt:110})');assert.equal(nodes.goalState.textContent,'目标已完成');assert.equal(nodes.goalTime.textContent,'1 小时 1 分 1 秒');
 run('showGoal({objective:"目标",status:"active",timeUsedSeconds:0,updatedAt:130})');assert.equal(nodes.goalTime.textContent,'0 分 0 秒');
});
test('桌面断开时只读回退到持久化 Goal；两种读取都失败时保留未知状态，不误报目标已移除',async()=>{
 const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const start=server.indexOf('   let questions=[]'),end=server.indexOf('   return json(200,{messages',start),code=server.slice(start,end);
 for(const fail of [false,true]){
  const goal={objective:'已有目标',status:'paused',timeUsedSeconds:75,updatedAt:110},calls=[];
  const ctx=vm.createContext({id:'thread',ipc:{snapshot:async()=>{throw Error('no-client-found');}},reader:{rpc:async(method,params)=>{calls.push({method,params});if(fail)throw Error('read timeout');return {goal};}}});
  const result=await vm.runInContext('(async()=>{'+code+'return {goal,questionError};})()',ctx);
  assert.equal(result.questionError,'no-client-found');assert.equal(result.goal,fail?undefined:goal);assert.equal(calls[0].method,'thread/goal/get');assert.equal(calls[0].params.threadId,'thread');
 }
});
