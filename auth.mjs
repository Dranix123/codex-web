import {scrypt,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
const derive=promisify(scrypt),SESSION_SECONDS=12*60*60;
export function parsePasswordHash(hash){
 if(typeof hash!=='string'||!/^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(hash))throw Error('访问密码哈希格式无效');
 const parts=hash.split('$');return {salt:Buffer.from(parts[4],'hex'),key:Buffer.from(parts[5],'hex')};
}
export async function verifyPassword(password,hash){
 if(typeof password!=='string'||!password||Buffer.byteLength(password)>1024)return false;
 const {salt,key}=parsePasswordHash(hash);
 const actual=await derive(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return timingSafeEqual(key,actual);
}
export function createPasswordGate(hash){
 if(hash)parsePasswordHash(hash);
 const sessions=new Map();let failed=0,blockedUntil=0,checking=false;
 const tokenOf=req=>/(?:^|;\s*)codexweb_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
 const digest=token=>createHash('sha256').update(token).digest('hex');
 function authenticated(req){
  const now=Date.now();for(const [key,expires]of sessions)if(expires<=now)sessions.delete(key);
  const token=tokenOf(req);return Boolean(hash&&token&&sessions.has(digest(token)));
 }
 function cookie(req,res,token,age){
  const secure=req.socket.encrypted||req.headers['x-forwarded-proto']?.split(',')[0].trim()==='https';
  res.setHeader('Set-Cookie',`codexweb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`);
 }
 async function asset(res,name,type){res.writeHead(200,{'Content-Type':type});res.end(await readFile(new URL('./public/'+name,import.meta.url)));}
 return {async handle(req,res,url){
  const path=url.pathname;
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&path==='/auth/login.css'){await asset(res,'login.css','text/css');return true;}
  if(req.method==='GET'&&path==='/auth/login.js'){await asset(res,'login.js','text/javascript');return true;}
  if(req.method==='GET'&&path==='/auth/status'){json(200,{configured:Boolean(hash),authenticated:authenticated(req)});return true;}
  if(req.method==='POST'&&(path==='/auth/login'||path==='/auth/logout')){
   if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{}if(origin?.host!==req.headers.host){json(403,{error:'禁止跨站请求'});return true;}}
   if(path==='/auth/logout'){const token=tokenOf(req);if(token)sessions.delete(digest(token));cookie(req,res,'',0);json(200,{ok:true});return true;}
   if(!hash){json(503,{error:'尚未配置访问密码'});return true;}
   if(Date.now()<blockedUntil){res.setHeader('Retry-After',String(Math.ceil((blockedUntil-Date.now())/1000)));json(429,{error:'尝试次数过多，请 5 分钟后再试'});return true;}
   if(checking){res.setHeader('Retry-After','1');json(429,{error:'正在验证，请稍后重试'});return true;}
   if(req.headers['content-type']!=='application/json'){json(415,{error:'需要 JSON'});return true;}
   checking=true;
   try{
    const chunks=[];let size=0;
    for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>8192){req.resume();json(413,{error:'请求过长'});return true;}chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{json(400,{error:'无效请求'});return true;}
    if(!await verifyPassword(body?.password,hash)){failed++;if(failed>=5){blockedUntil=Date.now()+5*60*1000;failed=0;}json(401,{error:'密码不正确'});return true;}
    failed=0;blockedUntil=0;authenticated(req);const old=tokenOf(req);if(old)sessions.delete(digest(old));
    if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
    const token=randomBytes(32).toString('base64url');sessions.set(digest(token),Date.now()+SESSION_SECONDS*1000);cookie(req,res,token,SESSION_SECONDS);json(200,{ok:true});return true;
   }finally{checking=false;}
  }
  if(authenticated(req))return false;
  if(req.method==='GET'&&path==='/'){await asset(res,'login.html','text/html; charset=utf-8');return true;}
  if(path.startsWith('/api/')||req.method!=='GET'){json(401,{error:'请先输入访问密码'});return true;}
  res.writeHead(303,{Location:'/'});res.end();return true;
 }};
}
