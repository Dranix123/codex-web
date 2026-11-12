import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./public/app.js',import.meta.url),'utf8');
test('手动额度刷新区分成功/失败时间，后台重试成功后清除失败提示',async()=>{
 let now=Date.UTC(2026,10,12,12,41,29),failing=false;const timers=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const nodes=Object.fromEntries(['limits','refreshLimits','quotaTime','quota'].map(id=>[id,{textContent:'',replaceChildren(){},append(){},matches:()=>true}]));
 const c=vm.createContext({$:id=>nodes[id],Date:Clock,document:{hidden:false,createElement:()=>({append(){},setAttribute(){}})},setTimeout:(fn,ms)=>{if(ms===1500)fn();else timers.push(fn);return timers.length;},clearTimeout:()=>{},api:async()=>{if(failing)throw Error('非 JSON HTTP 502');return {rateLimitsByLimitId:{},rateLimits:{primary:{usedPercent:20}}};}});
 vm.runInContext(source.slice(source.indexOf('let limitsPending='),source.indexOf("$('quota').addEventListener")),c);
 await vm.runInContext('limits()',c);const success=nodes.quotaTime.textContent;assert.match(success,/更新于/);
 now+=120000;failing=true;await vm.runInContext('limits()',c);
 assert.ok(nodes.quotaTime.textContent.includes(success.replace('更新于 ','')));assert.match(nodes.quotaTime.textContent,/刷新未成功，5 秒后重试/);assert.equal(timers.length,1);
 failing=false;timers[0]();await vm.runInContext('limitsPending',c);assert.match(nodes.quotaTime.textContent,/^更新于 /);assert.doesNotMatch(nodes.quotaTime.textContent,/失败|未成功|重试/);
});
