import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {conversationWork} from './bridge.mjs';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function workLabel('),source.indexOf('function updateWorkTime('));
const ctx=vm.createContext({Date:{now:()=>130000},workClockOffset:0});vm.runInContext(code,ctx);
const label=(work,now)=>vm.runInContext('workLabel('+JSON.stringify(work)+','+JSON.stringify(now)+')',ctx);
test('运行计时取原生开始时间，最终回复开始即固定耗时，优先于整轮耗时',()=>{
 const work=conversationWork({turns:[{turnId:'a',status:'inProgress',turnStartedAtMs:1000,firstTurnWorkItemStartedAtMs:2000,items:[{type:'agentMessage',phase:'commentary'}]}]})[0];
 assert.equal(label(work,63000),'正在运行 1 分 2 秒');assert.equal(label(work,64000),'正在运行 1 分 3 秒');
 const done=conversationWork({turns:[{turnId:'a',status:'inProgress',turnStartedAtMs:1000,finalAssistantStartedAtMs:63000,durationMs:90000,items:[{type:'agentMessage',phase:'final_answer'}]}]})[0];
 assert.equal(label(done,100000),'已运行 1 分 2 秒');assert.equal(label(done,200000),'已运行 1 分 2 秒');
});
test('历史、停止和缺失计时均不会无限增长或编造耗时',()=>{
 const work=conversationWork({turns:[{turnId:'a',status:'completed',turnStartedAtMs:1000,durationMs:3661000},{turnId:'b',status:'interrupted',turnStartedAtMs:1000,durationMs:12000},{turnId:'c',status:'completed',turnStartedAtMs:1000},{turnId:'d',status:'inProgress'}]});
 assert.equal(label(work[0],9000000),'已运行 1 小时 1 分 1 秒');assert.equal(label(work[1],9000000),'已停止 12 秒');assert.equal(label(work[2],9000000),'运行结束');assert.equal(label(work[3],9000000),'正在运行');assert.equal(label({...work[0],completedAtMs:0},9000000),'已运行');
});
test('canonical 历史支持计时；后续插入消息恢复工作时不使用前一个最终回复时间',()=>{
 const t={turnId:'a',status:'inProgress',turnStartedAtMs:1000,finalAssistantStartedAtMs:2000,items:[{type:'agentMessage',phase:'final_answer'},{type:'agentMessage',phase:'commentary'}]};
 const [work]=conversationWork({turnHistory:{kind:'canonical',history:{islands:[{entries:[{value:'a'}]}],entitiesByKey:{a:t}}}});
 assert.equal(work.status,'working');assert.equal(work.completedAtMs,null);assert.equal(label(work,5000),'正在运行 4 秒');
});
