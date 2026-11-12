import net from 'node:net';
import {applyThreadStatusChange} from './thread-status.mjs';
import {mkdir,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {attachmentInput} from './local-files.mjs';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
export class DesktopIPC {
  snapshots=new Map(); snapshotReads=new Map();
  watchedThreads=new Set(); sidebarStates=new Map(); sidebarOwners=new Map(); readContext=null; sidebarWatchUntil=0;
  pending=new Map(); buffer=Buffer.alloc(0); clientId='initializing-client';
  async connect(){
    this.socket=net.createConnection(`${homedir()}/.codex/ipc/ipc.sock`);
    this.socket.on('data',b=>{this.buffer=Buffer.concat([this.buffer,b]);while(this.buffer.length>=4){const n=this.buffer.readUInt32LE();if(n>268435456){this.socket.destroy();return;}if(this.buffer.length<n+4)break;const m=JSON.parse(this.buffer.subarray(4,n+4));this.buffer=this.buffer.subarray(n+4);this.receive(m);}});
    this.socket.on('error',()=>{});
    this.socket.on('close',()=>{for(const p of this.pending.values())p.reject(Error('桌面 IPC 已断开，请重启网页服务'));this.pending.clear();this.sidebarStates.clear();this.sidebarOwners.clear();this.watchedThreads.clear();});
    await new Promise((resolve,reject)=>{this.socket.once('connect',resolve);this.socket.once('error',reject);});
    const r=await this.request('initialize',{clientType:'codexweb'});this.clientId=r.result.clientId;
  }
  write(m){const b=Buffer.from(JSON.stringify(m)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);this.socket.write(Buffer.concat([h,b]));}
  receive(m){
    if(m.type==='broadcast'&&m.method==='client-status-changed'&&m.params?.status==='disconnected'){
      for(const [id,owner]of this.sidebarOwners)if(owner===m.params.clientId){this.sidebarStates.delete(id);this.sidebarOwners.delete(id);}
    }
    if(m.type==='broadcast'&&m.params?.hostId==='local'){
      const id=m.params.conversationId;
      if(m.method==='thread-read-state-changed'&&m.version===3){
        if(m.params.context)this.readContext=m.params.context;
        const current=this.sidebarStates.get(id)||{};this.sidebarStates.set(id,{...current,hasUnreadTurn:m.params.hasUnreadTurn});
      }
      if(m.method==='thread-stream-following-status-requested'&&this.watchedThreads.has(id))this.following(id,true);
      if(m.method==='thread-stream-state-changed'&&m.version===11&&this.watchedThreads.has(id)){
        const change=m.params.change,state=change.type==='snapshot'||this.sidebarOwners.get(id)===m.sourceClientId?applyThreadStatusChange(this.sidebarStates.get(id),change):null;
        if(state){this.sidebarStates.set(id,state);this.sidebarOwners.set(id,m.sourceClientId);}else this.following(id,true);
      }
    }
    if(m.type==='broadcast'&&m.method==='thread-stream-state-changed'&&m.params?.hostId==='local'&&m.params.change?.type==='snapshot')this.snapshots.get(m.params.conversationId)?.(m.params.change.conversationState);if(m.type==='client-discovery-request')this.write({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});if(m.type==='response'){const p=this.pending.get(m.requestId);if(p){this.pending.delete(m.requestId);m.resultType==='success'?p.resolve(m):p.reject(Error(m.error));}}}
  request(method,params,version=0){return new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('桌面请求超时，发送结果可能未知；请查看历史后再重试'));},20000);this.pending.set(requestId,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.write({type:'request',requestId,sourceClientId:this.clientId,method,params,version,timeoutMs:18000});});}
  async owner(id){return this.request('thread-owner-discovery',{hostId:'local',conversationId:id},1);}
  following(id,following){this.write({type:'broadcast',method:'thread-stream-following-changed',sourceClientId:this.clientId,version:1,params:{conversationId:id,hostId:'local',following}});}
  watchThreads(ids){
    this.sidebarWatchUntil=Date.now()+30000;
    const next=new Set(ids);
    for(const id of this.watchedThreads)if(!next.has(id)){if(!this.snapshotReads.has(id))this.following(id,false);this.sidebarStates.delete(id);this.sidebarOwners.delete(id);}
    for(const id of next)if(!this.watchedThreads.has(id))this.following(id,true);
    this.watchedThreads=next;
  }
  snapshot(id){
    if(this.snapshotReads.has(id))return this.snapshotReads.get(id);
    const read=(async()=>{
      await this.owner(id);
      try{return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('桌面问题状态同步超时')),5000);
        this.snapshots.set(id,state=>{clearTimeout(timer);resolve(state);});
        this.following(id,true);
      });}finally{this.snapshots.delete(id);if(!this.watchedThreads.has(id))this.following(id,false);}
    })().finally(()=>this.snapshotReads.delete(id));
    this.snapshotReads.set(id,read);return read;
  }
  async questions(id){return pendingQuestions(await this.snapshot(id));}
  async answer(id,requestId,answers){
    const questions=await this.questions(id),request=questions.find(q=>q.requestId===requestId);
    if(!request)throw Error('这个问题已回答或已失效，请刷新对话');
    if(!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('无效答案');
    const response={answers:{}};
    for(const q of request.questions){
      const values=answers[q.id]?.answers;
      if(!Array.isArray(values)||values.length!==1||typeof values[0]!=='string'||!values[0].trim()||values[0].length>16000)throw Error('请回答每个问题');
      response.answers[q.id]={answers:values};
    }
    if(request.kind==='async'){
      if(questions.some(q=>q.isBlocking))throw Error('请先回答当前的必答问题');
      const replies=request.questions.map(q=>({questionItemId:q.id,question:q.question,answer:response.answers[q.id].answers[0]}));
      const text='<send_user_message_question_reply>\n'+JSON.stringify(replies)+'\n</send_user_message_question_reply>';
      return this.request('thread-follower-start-turn',{conversationId:id,turnStart:{request:{threadId:id,input:[{type:'text',text,text_elements:[]}]},context:{inheritThreadSettings:true}}},2);
    }
    return this.request('thread-follower-submit-user-input',{conversationId:id,requestId,response},1);
  }
  async modelSettings(id){return (await this.request('thread-follower-read-model-settings',{conversationId:id},1)).result.settings;}
  async setModel(id,model,effort){return (await this.request('thread-follower-update-thread-settings',{conversationId:id,threadSettings:{model,effort}},2)).result;}
  async send(id,text,files=[]){if((await this.questions(id)).some(q=>q.isBlocking))throw Error('请先在问题区域提交答案');return this.request('thread-follower-start-turn',{conversationId:id,turnStart:{request:{threadId:id,input:[...(text.trim()?[{type:'text',text,text_elements:[]}]:[]),...attachmentInput(files)]},context:{inheritThreadSettings:true}}},2);}
}
export class Reader {
  pending=new Map(); sequence=0;
  async connect(){
    const env={...process.env};
    // Match macOS system proxy for the standalone read-only client.
    if(process.platform==='darwin'&&!env.HTTPS_PROXY){const p=execFileSync('scutil',['--proxy'],{encoding:'utf8'});const host=p.match(/HTTPSProxy : (\S+)/)?.[1],port=p.match(/HTTPSPort : (\d+)/)?.[1];if(/HTTPSEnable : 1/.test(p)&&host&&port)env.HTTPS_PROXY=env.HTTP_PROXY=`http://${host}:${port}`;}
    this.process=spawn(process.env.CODEX_BIN||'codex',['app-server'],{env,stdio:['pipe','pipe','pipe']});
    this.process.stderr.on('data',()=>{});
    this.process.on('error',e=>this.fail(e));this.process.on('exit',()=>this.fail(Error('Codex 读取进程已退出')));
    createInterface({input:this.process.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
    await this.rpc('initialize',{clientInfo:{name:'codexweb_reader',title:'Codex Web Reader',version:'0.1'},capabilities:{experimentalApi:true}});
    this.process.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }
  fail(e){for(const p of this.pending.values())p.reject(e);this.pending.clear();}
  rpc(method,params={}){if(!['initialize','project/list','thread/list','thread/read','thread/items/list','account/rateLimits/read','model/list'].includes(method))throw Error('只读客户端禁止此方法');return this.request(method,params);}
  async listProjects(){const data=[];let cursor;do{const page=await this.rpc('project/list',{limit:100,cursor});data.push(...page.data);cursor=page.nextCursor;}while(cursor);return {data};}
  async createProject(name,path,idempotencyKey){return (await this.request('project/create',{name,roots:[{path}],idempotencyKey})).project;}
  async createThread(project,model,effort){
    const cwd=project?project.roots[0].path:join(homedir(),'Documents','Codex',new Date().toISOString().slice(0,10)+'-'+randomUUID());
    if(!project)await mkdir(cwd,{recursive:true});
    let thread;
    try{({thread}=await this.request('thread/start',{projectId:project?.id??null,cwd,ephemeral:false,...model?{model}:{},...effort?{config:{model_reasoning_effort:effort}}:{}}));}
    catch(e){if(!project)await rmdir(cwd).catch(()=>{});throw e;}
    await this.request('thread/name/set',{threadId:thread.id,name:'新对话'});
    await this.request('thread/unsubscribe',{threadId:thread.id});
    return {...thread,name:'新对话'};
  }
  request(method,params){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`${method} 超时`));},30000);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.process.stdin.write(JSON.stringify({id,method,params})+'\n');});}
}

export function pendingQuestions(state){
  const pending=(state.requests||[]).flatMap(r=>{
    const params=r.method==='item/tool/requestUserInput'?r.params:r.method==='item/tool/call'&&r.params?.tool==='request_onboarding_input'?r.params.arguments:null;
    if(!Array.isArray(params?.questions))return [];
    return [{requestId:r.id,isBlocking:params.isBlocking!==false,questions:params.questions.map(q=>({id:q.id,header:q.header||'',question:q.question,isSecret:q.isSecret===true,options:q.options||[]}))}];
  });
  // Match the desktop's readUnansweredAsyncQuestions: only the last in-progress turn.
  const history=state.turnHistory?.kind==='canonical'?state.turnHistory.history:null;
  const turns=history?(history.islands||[]).flatMap(island=>island.entries.map(entry=>history.entitiesByKey[entry.value])).filter(Boolean):state.turns||[];
  const active=turns.findLast(turn=>turn.status==='inProgress');
  const items=active?.turnId!=null?active.items||[]:[];
  const answered=new Set();
  for(const item of items){
    if(item.type!=='userMessage'&&(item.type!=='steeringUserMessage'||item.status!=='accepted'))continue;
    const text=(item.content||item.input||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const match=text.match(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/);
    if(!match)continue;
    try{const parsed=JSON.parse(match[1]);for(const answer of Array.isArray(parsed)?parsed:[parsed])answered.add(answer.questionItemId);}catch{}
  }
  const seen=new Set();
  for(const item of items){
    if(item.type!=='agentMessage'||!item.questions?.length||seen.has(item.id))continue;seen.add(item.id);
    const questions=item.questions.map((q,index)=>({id:JSON.stringify(['request_user_input_async',item.id,index]),header:'',question:q.title,options:(q.options||[]).map(label=>({label}))})).filter(q=>!answered.has(q.id));
    if(questions.length)pending.push({requestId:'async:'+item.id,kind:'async',isBlocking:false,questions});
  }
  return pending;
}
