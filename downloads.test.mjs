import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scryptSync} from 'node:crypto';
import {downloadFile} from './downloads.mjs';
import {createPasswordGate} from './auth.mjs';

test('下载要求解锁，保留二进制内容和中文文件名，HEAD 不发送文件内容',async t=>{
 const root=await mkdtemp(join(tmpdir(),'codexweb-download-'));
 const path=join(root,'结果 "v1" (最终).bin'),bytes=Buffer.from([0,255,128,10,13,65]);await writeFile(path,bytes);
 const salt=Buffer.alloc(16,3),key=scryptSync('download-test-only',salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const gate=createPasswordGate('scrypt$32768$8$1$'+salt.toString('hex')+'$'+key.toString('hex'));
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');if(await gate.handle(req,res,url))return;
  try{await downloadFile(req,res,url.searchParams.get('path'));}catch{res.writeHead(400);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,url=base+'/api/files/download?'+new URLSearchParams({path});
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{method:'HEAD'})).status,401);
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'download-test-only'})});
 const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const head=await fetch(url,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('cache-control'),'no-store');
 const disposition=response.headers.get('content-disposition');assert.match(disposition,/^attachment;/);const encoded=disposition.split("filename*=UTF-8''")[1];assert.equal(decodeURIComponent(encoded),'结果 "v1" (最终).bin');assert.ok(!/[\r\n]/.test(disposition));
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await fetch(base+'/api/files/download?'+new URLSearchParams({path:root}),{headers})).status,400);
 assert.equal((await fetch(base+'/api/files/download?path=relative.txt',{headers})).status,400);
});
