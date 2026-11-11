import net from 'node:net';
import {attachmentInput} from './local-files.mjs';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
export class DesktopIPC {
  pending=new Map(); buffer=Buffer.alloc(0); clientId='initializing-client';
  async connect(){
    this.socket=net.createConnection(`${homedir()}/.codex/ipc/ipc.sock`);
    this.socket.on('data',b=>{this.buffer=Buffer.concat([this.buffer,b]);while(this.buffer.length>=4){const n=this.buffer.readUInt32LE();if(n>268435456){this.socket.destroy();return;}if(this.buffer.length<n+4)break;const m=JSON.parse(this.buffer.subarray(4,n+4));this.buffer=this.buffer.subarray(n+4);this.receive(m);}});
    this.socket.on('error',()=>{});
    this.socket.on('close',()=>{for(const p of this.pending.values())p.reject(Error('桌面 IPC 已断开，请重启网页服务'));this.pending.clear();});
    await new Promise((resolve,reject)=>{this.socket.once('connect',resolve);this.socket.once('error',reject);});
    const r=await this.request('initialize',{clientType:'codexweb'});this.clientId=r.result.clientId;
  }
  write(m){const b=Buffer.from(JSON.stringify(m)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);this.socket.write(Buffer.concat([h,b]));}
  receive(m){if(m.type==='client-discovery-request')this.write({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});if(m.type==='response'){const p=this.pending.get(m.requestId);if(p){this.pending.delete(m.requestId);m.resultType==='success'?p.resolve(m):p.reject(Error(m.error));}}}
  request(method,params,version=0){return new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('桌面请求超时，发送结果可能未知；请查看历史后再重试'));},20000);this.pending.set(requestId,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.write({type:'request',requestId,sourceClientId:this.clientId,method,params,version,timeoutMs:18000});});}
  async owner(id){return this.request('thread-owner-discovery',{hostId:'local',conversationId:id},1);}
  async modelSettings(id){return (await this.request('thread-follower-read-model-settings',{conversationId:id},1)).result.settings;}
  async setModel(id,model,effort){return (await this.request('thread-follower-update-thread-settings',{conversationId:id,threadSettings:{model,effort}},2)).result;}
  async send(id,text,files=[]){await this.owner(id);return this.request('thread-follower-start-turn',{conversationId:id,turnStart:{request:{threadId:id,input:[...(text.trim()?[{type:'text',text,text_elements:[]}]:[]),...attachmentInput(files)]},context:{inheritThreadSettings:true}}},2);}
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
  async createThread(project,model,effort){const {thread}=await this.request('thread/start',{projectId:project.id,cwd:project.roots[0].path,ephemeral:false,...model?{model}:{},...effort?{config:{model_reasoning_effort:effort}}:{}});await this.request('thread/name/set',{threadId:thread.id,name:'新对话'});await this.request('thread/unsubscribe',{threadId:thread.id});return {...thread,name:'新对话'};}
  request(method,params){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`${method} 超时`));},30000);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.process.stdin.write(JSON.stringify({id,method,params})+'\n');});}
}
