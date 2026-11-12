import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {threadIndicator,applyThreadStatusChange,desktopUnreadIds} from './thread-status.mjs';
import {DesktopIPC} from './bridge.mjs';

test('桌面运行状态、等待输入/审批与未读标记遵循原生优先级',()=>{
 assert.equal(threadIndicator({threadRuntimeStatus:{type:'active',activeFlags:[]}},true),'running');
 for(const flag of ['waitingOnUserInput','waitingOnApproval'])assert.equal(threadIndicator({threadRuntimeStatus:{type:'active',activeFlags:[flag]}},true),null);
 assert.equal(threadIndicator({threadRuntimeStatus:{type:'systemError'}},true),null);
 assert.equal(threadIndicator({threadRuntimeStatus:{type:'idle'}},false),null);
 assert.equal(threadIndicator({threadRuntimeStatus:{type:'idle'}},true),'unread');
 assert.equal(threadIndicator({threadRuntimeStatus:{type:'notLoaded'}},true),'unread');
});

test('只保存实时侧栏状态，应用桌面增量补丁并拒绝缺失的版本',()=>{
 const initial=applyThreadStatusChange(null,{type:'snapshot',revision:1,conversationState:{threadRuntimeStatus:{type:'active',activeFlags:[]},hasUnreadTurn:false,turns:[{reasoning:'hidden'}]}});
 assert.ok(!JSON.stringify(initial).includes('hidden'));
 const waiting=applyThreadStatusChange(initial,{type:'patches',baseRevision:1,revision:2,patches:[{op:'add',path:['threadRuntimeStatus','activeFlags',0],value:'waitingOnUserInput'}]});
 assert.equal(threadIndicator(waiting),null);assert.deepEqual(initial.threadRuntimeStatus.activeFlags,[]);
 const resumed=applyThreadStatusChange(waiting,{type:'patches',baseRevision:2,revision:3,patches:[{op:'remove',path:['threadRuntimeStatus','activeFlags',0]}]});
 assert.equal(threadIndicator(resumed),'running');
 const done=applyThreadStatusChange(resumed,{type:'patches',baseRevision:3,revision:4,patches:[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle'}},{op:'replace',path:['hasUnreadTurn'],value:true}]});
 assert.equal(threadIndicator(done),'unread');
 assert.equal(applyThreadStatusChange(done,{type:'patches',baseRevision:1,revision:5,patches:[]}),null);
});

test('已读与未读来自桌面原生记录，不把全部已完成对话标蓝',()=>{
 const context={identity:{kind:'chatgpt',accountId:'account',userId:'user'},executionHostKey:'local:host'};
 const key=createHash('sha256').update(JSON.stringify(['chatgpt','account','user'])).digest('hex');
 const global={'electron-thread-read-state-v1':{unreadByIdentity:{[key]:{'local:host':['unread'],'remote:host':['remote']}}}};
 assert.deepEqual([...desktopUnreadIds(global,context)],['unread']);
 assert.deepEqual([...desktopUnreadIds(global,null)],['unread']);
 global['electron-thread-read-state-v1'].unreadByIdentity.other={'local:other':['other-account']};
 assert.equal(desktopUnreadIds(global,null),null);
 assert.deepEqual([...desktopUnreadIds(global,context)],['unread']);
});

test('侧栏订阅不会启动对话，问题快照完成后保持状态订阅',async()=>{
 const bridge=new DesktopIPC(),sent=[];bridge.write=m=>sent.push(m);bridge.owner=async()=>{};
 bridge.watchThreads(['thread-one']);bridge.watchThreads(['thread-one']);
 assert.deepEqual(sent.map(m=>m.params.following),[true]);
 const reading=bridge.snapshot('thread-one');await Promise.resolve();
 bridge.receive({type:'broadcast',method:'thread-stream-state-changed',version:11,params:{hostId:'local',conversationId:'thread-one',change:{type:'snapshot',revision:1,conversationState:{threadRuntimeStatus:{type:'active',activeFlags:[]},requests:[]}}}});
 await reading;assert.ok(!sent.some(m=>m.params.following===false));
 assert.equal(threadIndicator(bridge.sidebarStates.get('thread-one')),'running');
 bridge.watchThreads([]);assert.equal(sent.at(-1).params.following,false);
 assert.ok(sent.every(m=>m.type==='broadcast'));
});

test('桌面窗口断开或流版本缺失时清除旧运行状态并重新同步',()=>{
 const bridge=new DesktopIPC(),sent=[];bridge.write=m=>sent.push(m);bridge.watchThreads(['thread-one']);
 const snapshot=sourceClientId=>bridge.receive({type:'broadcast',method:'thread-stream-state-changed',sourceClientId,version:11,params:{hostId:'local',conversationId:'thread-one',change:{type:'snapshot',revision:1,conversationState:{threadRuntimeStatus:{type:'active',activeFlags:[]},hasUnreadTurn:false}}}});
 snapshot('owner-new');
 bridge.receive({type:'broadcast',method:'thread-stream-state-changed',sourceClientId:'owner-old',version:11,params:{hostId:'local',conversationId:'thread-one',change:{type:'patches',baseRevision:1,revision:2,patches:[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle'}}]}}});
 assert.equal(threadIndicator(bridge.sidebarStates.get('thread-one')),'running');
 assert.equal(sent.at(-1).params.following,true);
 bridge.receive({type:'broadcast',method:'client-status-changed',params:{clientId:'owner-new',status:'disconnected'}});
 assert.equal(threadIndicator(bridge.sidebarStates.get('thread-one')),null);
});
