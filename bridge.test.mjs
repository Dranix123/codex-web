import test from 'node:test';
import assert from 'node:assert/strict';
import {stat,rmdir} from 'node:fs/promises';
import {DesktopIPC,Reader,pendingQuestions} from './bridge.mjs';
test('缺少桌面 owner 时拒绝发送，不另起推理',async()=>{
 const bridge=new DesktopIPC();const calls=[];
 bridge.request=async(method)=>{calls.push(method);throw Error('no-client-found');};
 await assert.rejects(bridge.send('test-thread','hello'),/no-client-found/);
 assert.deepEqual(calls,['thread-owner-discovery']);
});
test('读取通道拒绝恢复和启动推理',()=>{
 const reader=new Reader();for(const method of ['thread/resume','turn/start','thread/start'])assert.throws(()=>reader.rpc(method),/禁止/);
});
test('新对话先持久化名称，再释放给桌面，使用项目目录',async()=>{
 const reader=new Reader(),calls=[];
 reader.request=async(method,params)=>{calls.push({method,params});return method==='thread/start'?{thread:{id:'created-thread'}}:{};};
 const thread=await reader.createThread({id:'project',roots:[{path:'/tmp/project'}]});
 assert.equal(thread.id,'created-thread');
 assert.deepEqual(calls.map(c=>c.method),['thread/start','thread/name/set','thread/unsubscribe']);
 assert.equal(calls[0].params.cwd,'/tmp/project');assert.equal(calls[0].params.projectId,'project');assert.ok(!('model' in calls[0].params));
});
test('项目列表读取所有分页，保留末页新建的项目',async()=>{
 const reader=new Reader();
 reader.rpc=async(method,params)=>{assert.equal(method,'project/list');return params.cursor?{data:[{id:'new-project'}],nextCursor:null}:{data:[{id:'existing-project'}],nextCursor:'next-page'};};
 assert.deepEqual((await reader.listProjects()).data.map(p=>p.id),['existing-project','new-project']);
});

test('读取桌面快照后取消订阅，不把快照里的推理内容返回为问题',async()=>{
 const bridge=new DesktopIPC(),sent=[];bridge.owner=async()=>{};
 bridge.write=m=>{sent.push(m);if(m.params.following)queueMicrotask(()=>bridge.receive({type:'broadcast',method:'thread-stream-state-changed',params:{hostId:'local',conversationId:'thread',change:{type:'snapshot',conversationState:{requests:[{id:7,method:'item/tool/requestUserInput',params:{isBlocking:true,questions:[{id:'q',question:'选哪个？',header:'选择',options:[{label:'A',description:'方案 A'}]}]}}],turns:[{items:[{type:'reasoning',content:['hidden']}]}]}}}}));};
 const questions=await bridge.questions('thread');
 assert.equal(questions.length,1);assert.equal(questions[0].requestId,7);assert.equal(questions[0].isBlocking,true);
 assert.ok(!JSON.stringify(questions).includes('hidden'));
 assert.deepEqual(sent.map(m=>m.params.following),[true,false]);
});

test('问题答案通过原请求提交，不启动新一轮；过期或不完整答案拒绝发送',async()=>{
 const bridge=new DesktopIPC(),calls=[];
 bridge.questions=async()=>[{requestId:9,isBlocking:true,questions:[{id:'choice'},{id:'note'}]}];
 bridge.request=async(...args)=>{calls.push(args);return {result:{ok:true}};};
 await assert.rejects(bridge.answer('thread',8,{}),/已失效/);
 await assert.rejects(bridge.answer('thread',9,{choice:{answers:['A']}}),/每个问题/);
 assert.equal(calls.length,0);
 const answers={choice:{answers:['A']},note:{answers:['自定义答案']}};
 await bridge.answer('thread',9,answers);
 assert.deepEqual(calls,[['thread-follower-submit-user-input',{conversationId:'thread',requestId:9,response:{answers}},1]]);
 bridge.snapshot=async()=>({requests:[{id:9,method:'item/tool/requestUserInput',params:{questions:[]}}]});
 await assert.rejects(bridge.send('thread','普通消息'),/先在问题区域/);
 assert.equal(calls.length,1);
});


test('异步提问使用桌面原生问题回复格式，已回答项不再显示',async()=>{
 const item={id:'async-item',type:'agentMessage',questions:[{title:'选择颜色',options:['蓝色','红色']}]};
 const state={requests:[],turnHistory:{kind:'canonical',history:{islands:[{entries:[{value:'turn'}]}],entitiesByKey:{turn:{turnId:'turn-id',status:'inProgress',items:[item]}}}}};
 const questions=pendingQuestions(state),q=questions[0].questions[0];
 assert.equal(q.id,JSON.stringify(['request_user_input_async','async-item',0]));
 assert.equal(questions[0].isBlocking,false);
 const bridge=new DesktopIPC(),calls=[];bridge.questions=async()=>questions;bridge.snapshot=async()=>({requests:[]});bridge.request=async(...args)=>calls.push(args);
 await bridge.answer('thread',questions[0].requestId,{[q.id]:{answers:['蓝色']}});
 const [method,params,version]=calls[0];assert.equal(method,'thread-follower-start-turn');assert.equal(version,2);
 const content=params.turnStart.request.input;
 assert.match(content[0].text,/<send_user_message_question_reply>/);
 state.turnHistory.history.entitiesByKey.turn.items.push({id:'reply',type:'userMessage',content});
 assert.deepEqual(pendingQuestions(state),[]);
 state.turnHistory.history.entitiesByKey.turn.items[1]={type:'steeringUserMessage',status:'pending',input:content};
 assert.equal(pendingQuestions(state).length,1);
});


test('异步提问跟随桌面活动轮次，历史、已完成和无轮次的占位状态不弹窗',()=>{
 const question=id=>({id,type:'agentMessage',questions:[{title:'额度区域错误文本？',options:['重试']}]});
 const old={turnId:'old',status:'completed',items:[question('old-question')]};
 const current={turnId:'current',status:'inProgress',items:[]};
 const state={requests:[],turns:[old,current]};
 assert.deepEqual(pendingQuestions(state),[]);
 current.items.push(question('current-question'));
 assert.equal(pendingQuestions(state)[0].requestId,'async:current-question');
 current.status='completed';assert.deepEqual(pendingQuestions(state),[]);
 current.status='interrupted';assert.deepEqual(pendingQuestions(state),[]);
 current.status='inProgress';state.turns.push({turnId:null,status:'inProgress',items:[]});
 assert.deepEqual(pendingQuestions(state),[]);
});

test('按桌面规范历史的轮次顺序判断，不依赖对象插入顺序',()=>{
 const item={id:'old-question',type:'agentMessage',questions:[{title:'旧问题'}]};
 const state={requests:[],turns:[{turnId:'old',status:'inProgress',items:[item]}],turnHistory:{kind:'canonical',history:{
  islands:[{entries:[{value:'old'},{value:'current'}]}],
  entitiesByKey:{current:{turnId:'current',status:'inProgress',items:[]},old:{turnId:'old',status:'inProgress',items:[item]}}
 }}};
 assert.deepEqual(pendingQuestions(state),[]);
});


test('无项目对话使用独立目录、空项目归属，并保留模型和 effort',async t=>{
 const reader=new Reader(),calls=[],directories=[];
 t.after(async()=>{for(const directory of directories)await rmdir(directory);});
 reader.request=async(method,params)=>{
  calls.push({method,params});
  if(method==='thread/start'){directories.push(params.cwd);return {thread:{id:'projectless-thread',cwd:params.cwd,projectId:params.projectId}};}
  return {};
 };
 const first=await reader.createThread(null,'test-model','high');
 const second=await reader.createThread(null);
 assert.equal(first.projectId,null);assert.notEqual(first.cwd,second.cwd);
 assert.match(first.cwd,/\/Documents\/Codex\/\d{4}-\d{2}-\d{2}-[a-f0-9-]+$/);
 assert.equal((await stat(first.cwd)).isDirectory(),true);
 assert.equal(calls[0].params.model,'test-model');assert.equal(calls[0].params.config.model_reasoning_effort,'high');
 assert.deepEqual(calls.slice(0,3).map(c=>c.method),['thread/start','thread/name/set','thread/unsubscribe']);
});

test('无项目对话启动失败时移除新建的空目录',async()=>{
 const reader=new Reader();let cwd;
 reader.request=async(method,params)=>{cwd=params.cwd;throw Error('start failed');};
 await assert.rejects(reader.createThread(null),/start failed/);
 await assert.rejects(stat(cwd),{code:'ENOENT'});
});


test('旧对话继承历史 effort，新设置优先且发送沿用同一 collaborationMode',async()=>{
 const {inheritedModelSettings,inheritedTurnSettings}=await import('./bridge.mjs');
 const state={requests:[],latestModel:'model',latestReasoningEffort:'low',latestCollaborationMode:{mode:'default',settings:{model:'model',reasoning_effort:'low'}},turns:[{params:{effort:'high'}}]};
 assert.equal(inheritedModelSettings({model:'model',reasoningEffort:'low'},state).reasoningEffort,'high');
 const bridge=new DesktopIPC();bridge.snapshot=async()=>state;let request;
 bridge.request=async(method,params)=>{request=params.turnStart.request;};await bridge.send('thread','继续');
 assert.equal(request.effort,'high');assert.equal(request.collaborationMode.settings.reasoning_effort,'high');
 state.latestThreadSettings={effort:'medium'};assert.equal(inheritedTurnSettings(state).effort,'medium');
 state.latestThreadSettings.effort=null;assert.equal(inheritedModelSettings({},state).reasoningEffort,null);
});
