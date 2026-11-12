import http from 'node:http';
import {desktopUnreadIds,threadIndicator} from './thread-status.mjs';
import {downloadFile} from './downloads.mjs';
import {createPasswordGate} from './auth.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {basename} from 'node:path';
import {browseDirectory,resolveDirectory,resolveAttachments,saveUpload,MAX_UPLOAD_BYTES} from './local-files.mjs';
import {DesktopIPC,Reader,pendingQuestions,conversationActivity,conversationWork,editableMessage} from './bridge.mjs';
import {SendReceipts} from './send-receipts.mjs';
const authConfig=await readFile(new URL('./.local/auth.json',import.meta.url),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
const passwordGate=createPasswordGate(authConfig.passwordHash);
const ipc=new DesktopIPC(),reader=new Reader();
await reader.connect();let ipcError=null;try{await ipc.connect();}catch(e){ipcError=e.message;}
const csrf=randomBytes(24).toString('hex');
const sendReceipts=new SendReceipts();
setInterval(()=>{if(ipc.watchedThreads.size&&Date.now()>ipc.sidebarWatchUntil)ipc.watchThreads([]);},15000).unref();
const state=async()=>JSON.parse(await readFile(`${homedir()}/.codex/.codex-global-state.json`,'utf8'));
const createdPath=new URL('./.local/threads.json',import.meta.url);
let createdIds=JSON.parse(await readFile(createdPath,'utf8').catch(e=>{if(e.code==='ENOENT')return '[]';throw e;}));
const openThread=id=>promisify(execFile)('/usr/bin/open',['-a','/Applications/ChatGPT.app',`codex://threads/${id}?hostId=local`]);
const userText=text=>{
 const match=text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
 if(!match)return text;
 try{const value=JSON.parse(match[1]),replies=Array.isArray(value)?value:[value];if(replies.every(r=>typeof r.question==='string'&&typeof r.answer==='string'))return replies.map(r=>'回答「'+r.question+'」：'+r.answer).join('\n');}catch{}
 return text;
};
const publicThread=t=>({id:t.id,title:t.name||t.preview||'未命名对话',cwd:t.cwd,projectId:t.projectId,updatedAt:t.updatedAt});
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 try{
  const u=new URL(req.url,'http://localhost');
  if(await passwordGate.handle(req,res,u))return;
  if((req.method==='GET'||req.method==='HEAD')&&u.pathname==='/api/files/download'){
   try{await downloadFile(req,res,u.searchParams.get('path'));}
   catch(e){if(res.headersSent)res.destroy();else json(e.code==='ENOENT'?404:e.code==='EACCES'?403:400,{error:'无法下载文件：'+e.message});}return;
  }
  if(req.method==='POST'){
   if(req.headers['x-codexweb-token']!==csrf)return json(403,{error:'请求校验失败'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(403,{error:'禁止跨站请求'});
   if(u.pathname==='/api/files/upload'){
    if(req.headers['content-type']!=='application/octet-stream')return json(415,{error:'需要文件二进制内容'});
    if(Number(req.headers['content-length'])>MAX_UPLOAD_BYTES)return json(413,{error:'单个文件不能超过 50 MB'});
    const id=u.searchParams.get('id');if(!/^[a-zA-Z0-9-]{10,80}$/.test(id||''))return json(400,{error:'请先选择对话'});
    const {thread}=await reader.rpc('thread/read',{threadId:id});
    try{const file=await saveUpload(u.searchParams.get('folder')||thread.cwd,u.searchParams.get('name'),req.iterator({destroyOnReturn:false}));return json(201,{file});}
    catch(e){req.resume();return json(400,{error:'上传失败：'+e.message});}
   }
   if(req.headers['content-type']!=='application/json')return json(415,{error:'需要 JSON'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)return json(413,{error:'消息过长'});}const b=JSON.parse(raw);
   if(u.pathname==='/api/thread-statuses'){
    if(!Array.isArray(b.ids)||b.ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{10,80}$/.test(id)))return json(400,{error:'无效对话列表'});
    ipc.watchThreads(b.ids);const unread=desktopUnreadIds(await state(),ipc.readContext);
    return json(200,{states:b.ids.map(id=>({id,indicator:threadIndicator(ipc.sidebarStates.get(id),unread?.has(id))}))});
   }
   if(u.pathname==='/api/files/browse'){
    try{return json(200,await browseDirectory(b.path||homedir(),b.foldersOnly===true));}catch(e){return json(400,{error:'无法打开文件夹：'+e.message});}
   }
   if(u.pathname==='/api/files/resolve'){
    try{return json(200,{files:await resolveAttachments(b.paths)});}catch(e){return json(400,{error:e.message});}
   }
   if(u.pathname==='/api/projects/create'){
    if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>128)return json(400,{error:'请输入项目名称（最多 128 字）'});
    if(typeof b.key!=='string'||!/^[-a-zA-Z0-9]{10,80}$/.test(b.key))return json(400,{error:'无效的创建请求'});
    let path;try{path=await resolveDirectory(b.path);}catch(e){return json(400,{error:'无法使用此文件夹：'+e.message});}
    const project=await reader.createProject(b.name.trim(),path,b.key);
    return json(201,{project});
   }
   if(u.pathname==='/api/create'){
    let project=null;
    if(b.projectId!=null&&b.projectId!==''){
     const {data:projects}=await reader.listProjects();project=projects.find(p=>p.id===b.projectId);
     if(!project?.roots?.length)return json(400,{error:'请选择有效的项目'});
    }
    let model;
    if(b.model||b.effort){const {data:models}=await reader.rpc('model/list',{limit:100});model=models.find(m=>!m.hidden&&(b.model?m.model===b.model:m.isDefault));if(!model)return json(400,{error:'无效模型'});if(b.effort&&!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===b.effort))return json(400,{error:'该模型不支持这个思考强度'});}
    const thread=await reader.createThread(project,model?.model,b.effort||undefined);
    createdIds.unshift(thread.id);await mkdir(new URL('./.local/',import.meta.url),{recursive:true});await writeFile(createdPath,JSON.stringify(createdIds));
    let warning=null;
    try{await openThread(thread.id);}catch{warning='对话已创建，但桌面打开失败，请在列表中重新打开。';}
    return json(201,{thread:publicThread(thread),warning});
   }
   if(!/^[a-zA-Z0-9-]{10,80}$/.test(b.id||''))return json(400,{error:'无效对话'});
   if(u.pathname==='/api/model'){const {data:models}=await reader.rpc('model/list',{limit:100});const model=models.find(m=>m.model===b.model&&!m.hidden);if(!model)return json(400,{error:'无效模型'});if(b.effort!=null&&b.effort!==''&&!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===b.effort))return json(400,{error:'该模型不支持这个思考强度'});const result=await ipc.setModel(b.id,model.model,b.effort||undefined);if(!result.applied)return json(409,{error:'模型设置未应用，请重新选择对话'});return json(200,result);}
   if(u.pathname==='/api/open'){await openThread(b.id);return json(200,{ok:true});}
   if(u.pathname==='/api/stop'){if(typeof b.turnId!=='string'||!b.turnId)return json(400,{error:'缺少当前轮次'});return json(200,await ipc.stop(b.id,b.turnId));}
   if(u.pathname==='/api/questions/answer'){await ipc.answer(b.id,b.requestId,b.answers);return json(200,{ok:true});}
   if(u.pathname==='/api/edit'){if(typeof b.text!=='string'||!b.text.trim()||typeof b.expectedText!=='string'||typeof b.turnId!=='string'||!/^[a-f0-9-]{36}$/.test(b.clientMessageId||''))return json(400,{error:'无效消息编辑'});await sendReceipts.send(b.clientMessageId,b.id,()=>ipc.editLastMessage(b.id,b.turnId,b.expectedText,b.text,b.clientMessageId));return json(200,{ok:true});}
   if(u.pathname==='/api/send'){if(typeof b.text!=='string')return json(400,{error:'无效消息'});let files;try{files=await resolveAttachments(b.files);}catch(e){return json(400,{error:e.message});}if(!b.text.trim()&&!files.length)return json(400,{error:'请输入消息或附加文件'});if(ipcError)throw Error(ipcError);if(b.clientMessageId!=null&&!/^[a-f0-9-]{36}$/.test(b.clientMessageId))return json(400,{error:'无效消息标识'});await sendReceipts.send(b.clientMessageId,b.id,()=>ipc.send(b.id,b.text,files,b.clientMessageId));return json(200,{ok:true});}
   return json(404,{error:'未找到'});
  }
  if(req.method!=='GET')return json(405,{error:'方法不支持'});
  if(u.pathname==='/api/bootstrap'){
   const [projects,s]=await Promise.all([reader.listProjects(),state()]);return json(200,{projects:projects.data,token:csrf,ipcError,selectedProject:s['selected-project'],notice:'消息由桌面 App 处理；未打开的对话请先在桌面打开。网页选择独立于桌面当前标签。'});
  }
  if(u.pathname==='/api/threads'){
   const result=await reader.rpc('thread/list',{limit:100,cursor:u.searchParams.get('cursor')||null,useStateDbOnly:true,sortKey:'updated_at'}),s=await state();
   if(!u.searchParams.get('cursor')){const existing=new Set(result.data.map(t=>t.id));for(const id of [...createdIds].reverse()){if(existing.has(id))continue;try{const {thread}=await reader.rpc('thread/read',{threadId:id});result.data.unshift(thread);}catch{}}}
   const mapping=Object.values(s['app-server-project-id-by-legacy-project-id-by-host']||{}).reduce((a,b)=>Object.assign(a,b),{});
   return json(200,{data:result.data.map(t=>{const a=s['thread-project-assignments']?.[t.id];return {...publicThread(t),projectId:t.projectId||mapping[a?.projectId]||null};}),nextCursor:result.nextCursor});
  }
  if(u.pathname==='/api/messages'){
   const id=u.searchParams.get('id');const r=await reader.rpc('thread/items/list',{threadId:id,limit:100,sortDirection:'desc',cursor:u.searchParams.get('cursor')||null});
   const messages=r.data.flatMap(({item,turnId})=>item.type==='agentMessage'?[{id:item.id,turnId,role:'assistant',text:item.text,phase:item.phase}]:item.type==='userMessage'?[{id:item.id,turnId,role:'user',clientId:item.clientId,text:item.content.map(c=>c.type==='text'?userText(c.text):c.type==='mention'?'📎 '+c.name:c.type==='localImage'?'📎 '+basename(c.path):c.type==='image'?'📎 图片':'').filter(Boolean).join('\n')}]:[]).reverse();
   let questions=[],questionError=null,activity=null,editable=null,goal,work;try{const snapshot=await ipc.snapshot(id);questions=pendingQuestions(snapshot);activity=conversationActivity(snapshot);work={turns:conversationWork(snapshot),observedAtMs:Date.now()};editable=editableMessage(snapshot);goal=snapshot.threadGoal??null;}catch(e){questionError=e.message;}
   if(questionError)try{({goal}=await reader.rpc('thread/goal/get',{threadId:id}));}catch{}
   return json(200,{messages,nextCursor:r.nextCursor,questions,questionError,activity,editable,goal,work,sentClientIds:sendReceipts.forThread(id)});
  }
  if(u.pathname==='/api/limits'){const r=await reader.rpc('account/rateLimits/read');return json(200,{rateLimits:r.rateLimits,rateLimitsByLimitId:r.rateLimitsByLimitId});}
  if(u.pathname==='/api/models'){const {data}=await reader.rpc('model/list',{limit:100});return json(200,{models:data.filter(m=>!m.hidden).map(m=>({id:m.model,name:m.displayName,description:m.description,isDefault:m.isDefault,defaultEffort:m.defaultReasoningEffort,efforts:m.supportedReasoningEfforts}))});}
  if(u.pathname==='/api/model')return json(200,await ipc.modelSettings(u.searchParams.get('id')));
  if(u.pathname==='/api/owner'){await ipc.owner(u.searchParams.get('id'));return json(200,{connected:true});}
  const file={'/':'index.html','/app.js':'app.js','/choices.js':'choices.js','/markdown.js':'markdown.js','/markdown-it.js':'../node_modules/markdown-it/dist/browser/markdown-it.umd.min.js','/style.css':'style.css'}[u.pathname];if(!file)return json(404,{error:'未找到'});
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(await readFile(new URL(`./public/${file}`,import.meta.url)));
 }catch(e){json(502,{error:e.message});}
});
server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Codex Web: http://localhost:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{reader.process.kill();ipc.socket?.destroy();server.close();process.exit();});
