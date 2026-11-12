import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {scryptSync} from 'node:crypto';
import {createPasswordGate,parsePasswordHash,verifyPassword} from './auth.mjs';
const password='test-only-password-测试',salt=Buffer.alloc(16,7);
const hash='scrypt$32768$8$1$'+salt.toString('hex')+'$'+scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
async function serve(t,configuredHash=hash){
 const gate=createPasswordGate(configuredHash);
 const server=http.createServer(async(req,res)=>{if(!await gate.handle(req,res,new URL(req.url,'http://localhost'))){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"private":true}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 return 'http://127.0.0.1:'+server.address().port;
}
const login=(base,value,extra={})=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...extra},body:JSON.stringify({password:value})});
test('scrypt 格式校验、正确密码和错误密码',async()=>{
 assert.equal(parsePasswordHash(hash).key.length,64);
 assert.throws(()=>parsePasswordHash('plaintext'),/格式无效/);
 assert.equal(await verifyPassword(password,hash),true);
 assert.equal(await verifyPassword(password+'wrong',hash),false);
 assert.equal(await verifyPassword('',hash),false);
});
test('未解锁时拦截页面、私有脚本、项目和文件接口',async t=>{
 const base=await serve(t);
 assert.match(await (await fetch(base+'/')).text(),/输入访问密码/);
 for(const path of ['/api/bootstrap','/api/threads','/api/limits','/api/files/download?path=/tmp/private.txt'])assert.equal((await fetch(base+path)).status,401);
 for(const path of ['/api/files/browse','/api/files/upload','/api/projects/create'])assert.equal((await fetch(base+path,{method:'POST',body:'not authorised'})).status,401);
 const asset=await fetch(base+'/app.js',{redirect:'manual'});assert.equal(asset.status,303);assert.equal(asset.headers.get('location'),'/');
 const status=await (await fetch(base+'/auth/status')).json();assert.deepEqual(status,{configured:true,authenticated:false});
 assert.ok(!JSON.stringify(status).includes(hash));
});
test('输入一次密码即可访问不同功能，锁定后会话失效',async t=>{
 const base=await serve(t);
 assert.equal((await login(base,'wrong')).status,401);
 const result=await login(base,password,{'X-Forwarded-Proto':'https'});assert.equal(result.status,200);
 const cookie=result.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Max-Age=43200/);assert.match(cookie,/Secure/);
 const session=cookie.split(';')[0];
 for(const path of ['/','/api/bootstrap','/api/files/browse','/choices.js'])assert.equal((await fetch(base+path,{headers:{Cookie:session}})).status,200);
 const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:session,Origin:base}});assert.equal(logout.status,200);
 assert.equal((await fetch(base+'/api/bootstrap',{headers:{Cookie:session}})).status,401);
});
test('拒绝跨站解锁，并限制密码猜测次数',async t=>{
 const base=await serve(t);
 assert.equal((await login(base,password,{Origin:'https://other.example'})).status,403);
 for(let i=0;i<5;i++)assert.equal((await login(base,'wrong')).status,401);
 const limited=await login(base,password);assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});
test('未配置哈希时默认禁止访问',async t=>{
 const base=await serve(t,null);assert.equal((await login(base,password)).status,503);assert.equal((await fetch(base+'/api/bootstrap')).status,401);
});
