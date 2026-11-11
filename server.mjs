import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {DesktopIPC,Reader} from './bridge.mjs';
const ipc=new DesktopIPC(),reader=new Reader();
await reader.connect();let ipcError=null;try{await ipc.connect();}catch(e){ipcError=e.message;}
const csrf=randomBytes(24).toString('hex');
const state=async()=>JSON.parse(await readFile(`${homedir()}/.codex/.codex-global-state.json`,'utf8'));
const createdPath=new URL('./.local/threads.json',import.meta.url);
let createdIds=JSON.parse(await readFile(createdPath,'utf8').catch(e=>{if(e.code==='ENOENT')return '[]';throw e;}));
const openThread=id=>promisify(execFile)('/usr/bin/open',['-a','/Applications/ChatGPT.app',`codex://threads/${id}?hostId=local`]);
const publicThread=t=>({id:t.id,title:t.name||t.preview||'未命名对话',cwd:t.cwd,projectId:t.projectId,updatedAt:t.updatedAt});
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='POST'){
   if(req.headers['x-codexweb-token']!==csrf)return json(403,{error:'请求校验失败'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(403,{error:'禁止跨站请求'});
   if(req.headers['content-type']!=='application/json')return json(415,{error:'需要 JSON'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)return json(413,{error:'消息过长'});}const b=JSON.parse(raw);
   if(u.pathname==='/api/create'){
    const {data:projects}=await reader.rpc('project/list',{});
    const project=projects.find(p=>p.id===b.projectId);
    if(!project?.roots?.length)return json(400,{error:'请选择有效的项目'});
    let model;
    if(b.model||b.effort){const {data:models}=await reader.rpc('model/list',{limit:100});model=models.find(m=>!m.hidden&&(b.model?m.model===b.model:m.isDefault));if(!model)return json(400,{error:'无效模型'});if(b.effort&&!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===b.effort))return json(400,{error:'该模型不支持这个思考强度'});}
    const thread=await reader.createThread(project,model?.model,b.effort||undefined);
    createdIds.unshift(thread.id);await mkdir(new URL('./.local/',import.meta.url),{recursive:true});await writeFile(createdPath,JSON.stringify(createdIds));
    let warning=null;
    try{await openThread(thread.id);}catch{warning='对话已创建，但桌面打开失败，请在列表中重新打开。';}
    return json(201,{thread:publicThread(thread),warning});
   }
   if(!/^[a-zA-Z0-9-]{10,80}$/.test(b.id||''))return json(400,{error:'无效对话'});
   if(u.pathname==='/api/model'){const {data:models}=await reader.rpc('model/list',{limit:100});const model=models.find(m=>m.model===b.model&&!m.hidden);if(!model)return json(400,{error:'无效模型'});if(b.effort!=null&&b.effort!==''&&!model.supportedReasoningEfforts.some(e=>e.reasoningEffort===b.effort))return json(400,{error:'该模型不支持这个思考强度'});const result=await ipc.setModel(b.id,model.model,b.effort||model.defaultReasoningEffort);if(!result.applied)return json(409,{error:'模型设置未应用，请重新选择对话'});return json(200,result);}
   if(u.pathname==='/api/open'){await openThread(b.id);return json(200,{ok:true});}
   if(u.pathname==='/api/send'){if(typeof b.text!=='string'||!b.text.trim())return json(400,{error:'请输入消息'});if(ipcError)throw Error(ipcError);await ipc.send(b.id,b.text);return json(200,{ok:true});}
   return json(404,{error:'未找到'});
  }
  if(req.method!=='GET')return json(405,{error:'方法不支持'});
  if(u.pathname==='/api/bootstrap'){
   const [projects,s]=await Promise.all([reader.rpc('project/list',{}),state()]);return json(200,{projects:projects.data,token:csrf,ipcError,selectedProject:s['selected-project'],notice:'消息由桌面 App 处理；未打开的对话请先在桌面打开。网页选择独立于桌面当前标签。'});
  }
  if(u.pathname==='/api/threads'){
   const result=await reader.rpc('thread/list',{limit:100,cursor:u.searchParams.get('cursor')||null,useStateDbOnly:true,sortKey:'updated_at'}),s=await state();
   if(!u.searchParams.get('cursor')){const existing=new Set(result.data.map(t=>t.id));for(const id of [...createdIds].reverse()){if(existing.has(id))continue;try{const {thread}=await reader.rpc('thread/read',{threadId:id});result.data.unshift(thread);}catch{}}}
   const mapping=Object.values(s['app-server-project-id-by-legacy-project-id-by-host']||{}).reduce((a,b)=>Object.assign(a,b),{});
   return json(200,{data:result.data.map(t=>{const a=s['thread-project-assignments']?.[t.id];return {...publicThread(t),projectId:t.projectId||mapping[a?.projectId]||null};}),nextCursor:result.nextCursor});
  }
  if(u.pathname==='/api/messages'){
   const id=u.searchParams.get('id');const r=await reader.rpc('thread/items/list',{threadId:id,limit:100,sortDirection:'desc',cursor:u.searchParams.get('cursor')||null});
   const messages=r.data.flatMap(({item,turnId})=>item.type==='agentMessage'?[{id:item.id,turnId,role:'assistant',text:item.text}]:item.type==='userMessage'?[{id:item.id,turnId,role:'user',text:item.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}]:[]).reverse();
   return json(200,{messages,nextCursor:r.nextCursor});
  }
  if(u.pathname==='/api/limits'){const r=await reader.rpc('account/rateLimits/read');return json(200,{rateLimits:r.rateLimits,rateLimitsByLimitId:r.rateLimitsByLimitId});}
  if(u.pathname==='/api/models'){const {data}=await reader.rpc('model/list',{limit:100});return json(200,{models:data.filter(m=>!m.hidden).map(m=>({id:m.model,name:m.displayName,isDefault:m.isDefault,defaultEffort:m.defaultReasoningEffort,efforts:m.supportedReasoningEfforts}))});}
  if(u.pathname==='/api/model')return json(200,await ipc.modelSettings(u.searchParams.get('id')));
  if(u.pathname==='/api/owner'){await ipc.owner(u.searchParams.get('id'));return json(200,{connected:true});}
  const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[u.pathname];if(!file)return json(404,{error:'未找到'});
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(await readFile(new URL(`./public/${file}`,import.meta.url)));
 }catch(e){json(502,{error:e.message});}
});
server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Codex Web: http://localhost:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{reader.process.kill();ipc.socket?.destroy();server.close();process.exit();});
