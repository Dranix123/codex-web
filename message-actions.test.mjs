import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DesktopIPC,editableMessage} from './bridge.mjs';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const turn={turnId:'last',status:'completed',params:{input:[{type:'text',text:'original'},{type:'mention',name:'file',path:'/file'}]},items:[]};
test('编辑只允许空闲时最后一轮的原始消息，拒绝过期消息和插入消息',async()=>{
 const bridge=new DesktopIPC();let state={turns:[turn]};bridge.snapshot=async()=>state;const calls=[];bridge.request=async(...args)=>calls.push(args);
 assert.deepEqual(editableMessage(state),{turnId:'last',text:'original'});
 await assert.rejects(bridge.editLastMessage('thread','earlier','original','new','client'));
 await assert.rejects(bridge.editLastMessage('thread','last','changed','new','client'));
 await bridge.editLastMessage('thread','last','original','new','client');
 assert.deepEqual(calls[0],['thread-follower-edit-last-user-turn',{conversationId:'thread',turnId:'last',message:'new',clientUserMessageId:'client',allowEarlierMessages:false,shouldSendPermissionOverrides:false},2]);
 state={turns:[{...turn,status:'inProgress'}]};assert.equal(editableMessage(state),null);
 state={turns:[{...turn,items:[{type:'steeringUserMessage',status:'accepted'}]}]};assert.equal(editableMessage(state),null);
});
test('运行中的发送走原生 steer，保留附件和消息标识；空闲时启动新轮次',async()=>{
 const bridge=new DesktopIPC();let active=true;bridge.snapshot=async()=>({cwd:'/project',turns:[{...turn,status:active?'inProgress':'completed'}]});const calls=[];bridge.request=async(...args)=>calls.push(args);
 await bridge.send('thread','追加',[],'client');assert.equal(calls[0][0],'thread-follower-steer-turn');assert.equal(calls[0][2],1);assert.equal(calls[0][1].clientUserMessageId,'client');assert.equal(calls[0][1].input[0].text,'追加');assert.deepEqual(calls[0][1].restoreMessage.context.workspaceRoots,['/project']);
 active=false;await bridge.send('thread','新消息',[],'next');assert.equal(calls[1][0],'thread-follower-start-turn');
});
test('发送按钮随草稿、附件和等待确认切换，等待中不能重复发送',()=>{
 const classes=new Set(),nodes={send:{setAttribute(k,v){this[k]=v;},classList:{toggle(k,on){on?classes.add(k):classes.delete(k);}}},text:{value:'',addEventListener(){}}};
 const threadRuns=new Map([['thread',{running:true,turnId:'active'}]]),pendingSends=new Map(),sendingThreads=new Set();
 const ctx=vm.createContext({$:id=>nodes[id],selected:'thread',selectedAttachments:[],threadRuns,pendingSends,sendingThreads,stoppingThreads:new Set(),blockingQuestion:false});
 vm.runInContext(source.slice(source.indexOf('function updateSendButton(){'),source.indexOf('function waitForSend(')),ctx);
 const update=()=>vm.runInContext('updateSendButton()',ctx);
 update();assert.equal(nodes.send.textContent,'■');assert.equal(nodes.send['aria-label'],'停止任务');
 nodes.text.value='追加内容';update();assert.equal(nodes.send.textContent,'↑');assert.equal(nodes.send['aria-label'],'插入消息');assert.equal(nodes.send.disabled,false);
 nodes.text.value='';vm.runInContext('selectedAttachments=[{path:"/file"}]',ctx);update();assert.equal(nodes.send.textContent,'↑');
 pendingSends.set('thread',{waiting:true});update();assert.equal(classes.has('is-sending'),true);assert.equal(nodes.send.disabled,true);
 pendingSends.clear();threadRuns.set('thread',{running:false});update();assert.equal(nodes.send['aria-label'],'发送消息');
});
test('非 JSON 网关响应归为发送结果待确认，明确的 JSON 错误仍立即报错',async()=>{
 const ctx=vm.createContext({fetch:async()=>({status:502,ok:false,headers:{get:()=> 'text/html'}}),token:'token',location:{},setTimeout});
 vm.runInContext(source.slice(source.indexOf('async function api('),source.indexOf('function error(')),ctx);
 await assert.rejects(vm.runInContext('api("/api/send",{text:"hello"})',ctx),e=>e.uncertain===true);
 ctx.fetch=async()=>({status:502,ok:false,headers:{get:()=> 'application/json'},json:async()=>({error:'请先回答当前问题'})});
 await assert.rejects(vm.runInContext('api("/api/send",{text:"hello"})',ctx),e=>e.uncertain===false);
});
