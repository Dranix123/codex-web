import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopIPC,Reader} from './bridge.mjs';
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
