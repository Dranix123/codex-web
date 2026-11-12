import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('async function api('),source.indexOf('\nfunction error('));
function client(responses){let calls=0;const context=vm.createContext({token:'fixture',fetch:async()=>{calls++;return responses.shift();},setTimeout:fn=>fn(),location:{replace:()=>{}}});vm.runInContext(apiSource,context);return {context,calls:()=>calls};}
const broken=()=>new Response('{"messages":',{headers:{'content-type':'application/json'}});
test('不完整的只读 JSON 自动重试一次',async()=>{const c=client([broken(),Response.json({ok:true})]);assert.equal((await vm.runInContext('api("/api/messages")',c.context)).ok,true);assert.equal(c.calls(),2);});
test('连续不完整的响应不会无限重试',async()=>{const c=client([broken(),broken()]);await assert.rejects(vm.runInContext('api("/api/messages")',c.context),/接口响应内容不完整/);assert.equal(c.calls(),2);});
test('写操作即使响应不完整也不重发',async()=>{const c=client([broken()]);await assert.rejects(vm.runInContext('api("/api/send",{id:"thread",text:"message"})',c.context),/接口响应内容不完整/);assert.equal(c.calls(),1);});
