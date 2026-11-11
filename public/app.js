const $=id=>document.getElementById(id);
const drafts=new Map();
let token='',allThreads=[],threadCursor=null,selected='',olderCursor=null,polling=false,loading=false;
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Codexweb-Token':token},body:JSON.stringify(body)}:{});const x=await r.json();if(!r.ok)throw Error(x.error);return x;}
function error(e){$('notice').textContent=e.message;$('notice').className='error';}
function renderThreads(){const project=$('project').value,q=$('search').value.toLowerCase();$('threads').replaceChildren();for(const t of allThreads.filter(t=>(!project||t.projectId===project)&&t.title.toLowerCase().includes(q))){const b=document.createElement('button'),title=document.createElement('span');title.className='thread-title';title.textContent=t.title.slice(0,70);b.append(title);b.className=t.id===selected?'active':'';b.setAttribute('aria-current',t.id===selected?'true':'false');b.onclick=()=>select(t);$('threads').append(b);}if(!$('threads').childElementCount){const p=document.createElement('p');p.className='no-threads';p.textContent='没有匹配的对话';$('threads').append(p);}}
async function threads(append=false){const r=await api('/api/threads'+(append&&threadCursor?'?cursor='+encodeURIComponent(threadCursor):''));allThreads=append?[...allThreads,...r.data]:r.data;threadCursor=r.nextCursor;$('moreThreads').hidden=!threadCursor;renderThreads();}
function renderMessages(messages,prepend=false){const box=$('messages'),height=box.scrollHeight,nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;const nodes=messages.map(m=>{const a=document.createElement('article');a.className='message '+m.role;const role=document.createElement('small');role.textContent=m.role==='user'?'你':'CODEX';const p=document.createElement('p');p.textContent=m.text;a.append(role,p);return a;});if(!nodes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='开始一段新对话';nodes.push(empty);}if(prepend){box.prepend(...nodes);box.scrollTop=box.scrollHeight-height;}else{box.replaceChildren(...nodes);if(nearBottom)box.scrollTop=box.scrollHeight;}}
async function messages(older=false){const id=selected;if(!id||loading)return;loading=true;try{const r=await api('/api/messages?id='+encodeURIComponent(id)+(older&&olderCursor?'&cursor='+encodeURIComponent(olderCursor):''));if(selected!==id)return;if(older){hasOlderLoaded=true;history=[...r.messages,...history];}else {const ids=new Set(r.messages.map(m=>m.id));const first=history.findIndex(m=>ids.has(m.id));history=hasOlderLoaded&&first>=0?[...history.slice(0,first),...r.messages]:r.messages;}if(older||!hasOlderLoaded)olderCursor=r.nextCursor;$('older').hidden=!olderCursor;renderMessages(history);}finally{loading=false;}}
let history=[],hasOlderLoaded=false;
async function select(t){document.body.dataset.view='chat';$('messages').replaceChildren();if(selected)drafts.set(selected,$('text').value);selected=t.id;hasOlderLoaded=false;$('text').value=drafts.get(selected)||'';history=[];$('title').textContent=t.title;$('open').disabled=false;$('text').disabled=false;$('send').disabled=true;$('model').disabled=true;$('effort').disabled=true;$('notice').className='';$('notice').textContent='正在检查桌面会话…';renderThreads();try{await messages();$('messages').scrollTop=$('messages').scrollHeight;for(let attempt=0;attempt<2;attempt++){try{await api('/api/owner?id='+t.id);break;}catch(e){if(attempt===1)throw e;await new Promise(resolve=>setTimeout(resolve,600));if(selected!==t.id)return;}}if(selected!==t.id)return;$('notice').textContent='已连接桌面会话 · 每 3 秒同步纯文本；消息会直接发送。';$('send').disabled=false;const settings=await api('/api/model?id='+t.id);if(selected===t.id){await modelsReady;if(selected!==t.id)return;showModelSettings(settings);$('model').disabled=false;}}catch(e){if(selected===t.id)$('notice').textContent='请先在桌面 App 打开这个对话，再点「在桌面打开」重试连接。';}}
async function limits(){try{const r=await api('/api/limits'),buckets=Object.values(r.rateLimitsByLimitId||{codex:r.rateLimits});$('limits').replaceChildren();for(const b of buckets.filter(Boolean)){const card=document.createElement('div');card.className='bucket';const h=document.createElement('h3');h.textContent=b.limitName||b.limitId||'Codex';card.append(h);for(const [key,label]of [['primary','短期额度'],['secondary','每周额度']]){const w=b[key];if(!w)continue;const p=document.createElement('p');p.textContent=`${label} · 剩余 ${Math.max(0,100-w.usedPercent)}% · ${w.windowDurationMins??'?'} 分钟窗口`;const progress=document.createElement('progress');progress.max=100;progress.setAttribute('aria-label',label+'剩余额度');progress.value=Math.max(0,100-w.usedPercent);const reset=document.createElement('p');reset.textContent='重置：'+(w.resetsAt?new Date(w.resetsAt*1000).toLocaleString():'未知');card.append(p,progress,reset);}if(b.credits){const p=document.createElement('p');p.textContent='积分：'+(b.credits.balance??'未知');card.append(p);}$('limits').append(card);}$('quotaTime').textContent='更新于 '+new Date().toLocaleTimeString();}catch(e){$('limits').textContent='额度暂不可用：'+e.message;$('quotaTime').textContent='未取得实时额度';}}
$('project').onchange=renderThreads;$('search').oninput=renderThreads;$('moreThreads').onclick=()=>threads(true).catch(error);$('older').onclick=()=>messages(true).catch(error);$('refreshLimits').onclick=limits;
$('open').onclick=async()=>{try{await api('/api/open',{id:selected});const thread=allThreads.find(t=>t.id===selected);if(thread)await select(thread);}catch(e){error(e);}};
$('composer').onsubmit=async e=>{e.preventDefault();const text=$('text').value,id=selected;if(!text.trim())return;$('send').disabled=true;$('sendStatus').textContent='发送中…';try{await api('/api/send',{id,text});drafts.delete(id);if(selected===id)$('text').value='';$('sendStatus').textContent='已交给桌面 App';await messages();}catch(e){error(e);$('sendStatus').textContent='请先核对历史，避免重复发送';}finally{$('send').disabled=false;}};
async function init(){const r=await api('/api/bootstrap');token=r.token;$('connection').textContent=r.ipcError?'桌面 IPC 不可用':'本机已连接';$('notice').textContent=r.notice;for(const p of r.projects){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;$('project').append(o);$('newProject').append(o.cloneNode(true));}await threads();limits();}
init().catch(error);
let modelCatalog=[];
const effortLabels={none:'无',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',ultra:'Ultra'};
function fillEfforts(id,modelId,value=''){
  const select=$(id),model=modelCatalog.find(m=>m.id===modelId)||(!modelId?modelCatalog.find(m=>m.isDefault):null);
  select.replaceChildren();
  const defaultOption=document.createElement('option');defaultOption.value='';defaultOption.textContent=model?'默认（'+(effortLabels[model.defaultEffort]||model.defaultEffort)+'）':'思考强度';select.append(defaultOption);
  for(const effort of model?.efforts||[]){const o=document.createElement('option');o.value=effort.reasoningEffort;o.textContent=effortLabels[o.value]||o.value;o.title=effort.description;select.append(o);}
  select.value=[...select.options].some(o=>o.value===value)?value:'';
  select.disabled=!model?.efforts?.length;
}
function showModelSettings(settings){$('model').value=settings?.model||'';fillEfforts('effort',settings?.model||'',settings?.reasoningEffort||'');}
const modelsReady=api('/api/models').then(r=>{modelCatalog=r.models;for(const m of modelCatalog){for(const id of ['model','newModel']){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;$(id).append(o);}}fillEfforts('newEffort','');}).catch(()=>{$('model').title='模型列表暂不可用';});
setInterval(async()=>{if(document.hidden||polling)return;polling=true;try{await messages();}catch(e){error(e);}finally{polling=false;}},3000);
setInterval(()=>{if(!document.hidden)limits();},60000);

$('back').onclick=()=>{document.body.dataset.view='list';$('text').blur();$('threads').querySelector('[aria-current="true"]')?.focus({preventScroll:true});};
$('quota').setAttribute('popover','auto');
function syncViewport(){
  if(!window.visualViewport)return;
  document.documentElement.style.setProperty('--app-height',window.visualViewport.height+'px');
  document.documentElement.style.setProperty('--app-top',window.visualViewport.offsetTop+'px');
  document.body.classList.toggle('keyboard-open',window.innerHeight-window.visualViewport.height>120);
}
window.visualViewport?.addEventListener('resize',syncViewport);
window.visualViewport?.addEventListener('scroll',syncViewport);
syncViewport();

const systemTheme=matchMedia('(prefers-color-scheme: dark)');
let themePreference=null;
try{themePreference=localStorage.getItem('codexweb-theme');}catch{}
function applyTheme(){
  const dark=themePreference?themePreference==='dark':systemTheme.matches;
  document.documentElement.dataset.theme=dark?'dark':'light';
  $('theme').textContent=dark?'☀':'☾';
  $('theme').setAttribute('aria-label',dark?'切换到浅色模式':'切换到深色模式');
}
$('theme').onclick=()=>{themePreference=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('codexweb-theme',themePreference);}catch{}applyTheme();};
systemTheme.addEventListener('change',applyTheme);
applyTheme();
$('newThread').onclick=()=>{$('newProject').value=$('project').value;$('createStatus').textContent='对话将在所选项目中创建。';$('newDialog').showModal();};
$('cancelNew').onclick=()=>$('newDialog').close();
$('newForm').onsubmit=async e=>{
  e.preventDefault();const projectId=$('newProject').value;if(!projectId)return;
  $('confirmNew').disabled=true;$('cancelNew').disabled=true;$('createStatus').textContent='正在创建对话…';
  const preventClose=e=>e.preventDefault();$('newDialog').addEventListener('cancel',preventClose);
  try{
    const r=await api('/api/create',{projectId,model:$('newModel').value||undefined,effort:$('newEffort').value||undefined});
    $('project').value=projectId;$('search').value='';
    allThreads=[r.thread,...allThreads.filter(t=>t.id!==r.thread.id)];
    $('newDialog').close();await select(r.thread);
    if(r.warning)$('notice').textContent=r.warning;
  }catch(e){$('createStatus').textContent=e.message+'；请先刷新列表确认是否已创建，避免重复创建。';}
  finally{$('confirmNew').disabled=false;$('cancelNew').disabled=false;$('newDialog').removeEventListener('cancel',preventClose);}
};

async function updateModelSettings(){
  const id=selected,model=$('model').value,effort=$('effort').value;if(!id||!model)return;
  $('model').disabled=true;$('effort').disabled=true;
  try{await api('/api/model',{id,model,effort});if(selected===id)$('sendStatus').textContent='模型与思考强度已更新，下条消息生效';}
  catch(e){error(e);try{const settings=await api('/api/model?id='+id);if(selected===id)showModelSettings(settings);}catch{}}
  finally{if(selected===id){$('model').disabled=false;$('effort').disabled=!modelCatalog.find(m=>m.id===$('model').value)?.efforts?.length;}}
}
$('model').onchange=()=>{fillEfforts('effort',$('model').value,$('effort').value);updateModelSettings();};
$('effort').onchange=updateModelSettings;
$('newModel').onchange=()=>fillEfforts('newEffort',$('newModel').value,$('newEffort').value);
