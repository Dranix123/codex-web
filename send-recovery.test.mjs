import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {DesktopIPC} from './bridge.mjs';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function confirmSend('),source.indexOf("$('composer').onsubmit"));
for(const selected of ['thread','other'])test('发送确认后清空原草稿，切换对话也不恢复已发送内容：'+selected,()=>{
 const nodes={text:{value:selected==='thread'?'已发送':'其他对话草稿'},notice:{dataset:{kind:'send'},textContent:'502'},sendStatus:{textContent:'核对中'}};
 const pendingSends=new Map([['thread',{clientMessageId:'client',text:'已发送',files:['/sent']}]]),drafts=new Map([['thread','已发送']]),attachmentDrafts=new Map([['thread',[{path:'/sent'}]]]);
 const c=vm.createContext({$:id=>nodes[id],selected,pendingSends,drafts,attachmentDrafts,selectedAttachments:[{path:'/sent'}],renderAttachments:()=>{},updateSendButton:()=>{}});vm.runInContext(code,c);
 vm.runInContext('confirmSend("thread","client")',c);
 assert.equal(pendingSends.size,0);assert.equal(drafts.has('thread'),false);assert.equal(attachmentDrafts.get('thread').length,0);
 assert.equal(nodes.text.value,selected==='thread'?'':'其他对话草稿');
 if(selected==='thread'){assert.equal(vm.runInContext('selectedAttachments.length',c),0);assert.equal(nodes.sendStatus.textContent,'');assert.equal(nodes.notice.textContent,'');}
});
test('已确认发送只清理对应草稿，保留后来输入的新文字和新附件',()=>{
 const nodes={text:{value:'新草稿'},notice:{dataset:{kind:'send'},textContent:'502'},sendStatus:{textContent:'核对中'}};
 const pendingSends=new Map([['thread',{clientMessageId:'client',text:'已发送',files:['/sent']}]]),drafts=new Map([['thread','新草稿']]),attachmentDrafts=new Map([['thread',[{path:'/sent'},{path:'/new'}]]]);
 const c=vm.createContext({$:id=>nodes[id],selected:'thread',pendingSends,drafts,attachmentDrafts,selectedAttachments:[{path:'/sent'},{path:'/new'}],renderAttachments:()=>{},updateSendButton:()=>{}});vm.runInContext(code,c);
 vm.runInContext('confirmSend("thread","wrong")',c);assert.equal(pendingSends.size,1);
 vm.runInContext('confirmSend("thread","client")',c);assert.equal(pendingSends.size,0);assert.equal(nodes.text.value,'新草稿');assert.equal(drafts.get('thread'),'新草稿');assert.equal(nodes.notice.textContent,'');assert.equal(nodes.sendStatus.textContent,'');assert.equal(attachmentDrafts.get('thread')[0].path,'/new');
});
test('发送时透传原生用户消息标识供历史确认',async()=>{
 const bridge=new DesktopIPC();bridge.snapshot=async()=>({requests:[]});let params;bridge.request=async(method,p)=>{params=p;};await bridge.send('thread','text',[],'client-id');assert.equal(params.turnStart.request.clientUserMessageId,'client-id');
});
