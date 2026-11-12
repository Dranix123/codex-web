const $=id=>document.getElementById(id);
const drafts=new Map(),attachmentDrafts=new Map(),expandedProcesses=new Set(),messageLoads=new Set(),threadIndicators=new Map();
let projectCatalog=[],selectedAttachments=[];
let token='',allThreads=[],threadCursor=null,selected='',olderCursor=null,polling=false;
async function api(path,body){
 const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Codexweb-Token':token},body:JSON.stringify(body)}:{});
 if(r.status===401){location.replace('/');throw Object.assign(Error('请重新输入访问密码'),{status:401});}
 const type=r.headers.get('content-type')||'';
 if(!type.includes('application/json')){
  const message=r.status===403?'接口访问被拒绝（HTTP 403），请重新打开网页完成验证':r.redirected?'接口返回了访问验证页面，请重新打开网页完成验证':'接口返回了非 JSON 响应（HTTP '+r.status+'），请稍后重试';
  throw Error(message);
 }
 let x;try{x=await r.json();}catch{throw Error('接口响应内容不完整（HTTP '+r.status+'），请稍后重试');}
 if(!r.ok){if(x.error?.includes('no-client-found'))throw Object.assign(Error('桌面对话尚未连接，请在桌面打开后重试'),{kind:'connection'});throw Error(x.error||'请求失败（HTTP '+r.status+'）');}return x;
}
function error(e){if(e.kind==='connection')$('notice').dataset.kind='connection';else delete $('notice').dataset.kind;$('notice').textContent=e.message;$('notice').className='error';}
function renderThreads(){const project=$('project').value,q=$('search').value.toLowerCase();$('threads').replaceChildren();for(const t of allThreads.filter(t=>(!project||t.projectId===project)&&t.title.toLowerCase().includes(q))){const b=document.createElement('button'),title=document.createElement('span');title.className='thread-title';title.textContent=t.title.slice(0,70);const indicator=document.createElement('span');indicator.className='thread-indicator';indicator.setAttribute('role','img');indicator.hidden=true;b.dataset.threadId=t.id;b.append(title,indicator);b.className=t.id===selected?'active':'';b.setAttribute('aria-current',t.id===selected?'true':'false');b.onclick=()=>select(t);$('threads').append(b);}if(!$('threads').childElementCount){const p=document.createElement('p');p.className='no-threads';p.textContent='没有匹配的对话';$('threads').append(p);}updateThreadIndicators();}
async function threads(append=false){const r=await api('/api/threads'+(append&&threadCursor?'?cursor='+encodeURIComponent(threadCursor):''));allThreads=append?[...allThreads,...r.data]:r.data;threadCursor=r.nextCursor;$('moreThreads').hidden=!threadCursor;renderThreads();refreshThreadIndicators();}
function updateThreadIndicators(){
 for(const button of $('threads').querySelectorAll('button[data-thread-id]')){
  const state=threadIndicators.get(button.dataset.threadId),marker=button.querySelector('.thread-indicator');
  marker.hidden=!state;marker.className='thread-indicator'+(state?' '+state:'');
  marker.setAttribute('aria-label',state==='running'?'正在运行':'未读更新');
 }
}
let threadStatusPending=false;
async function refreshThreadIndicators(){
 if(threadStatusPending||!allThreads.length)return;threadStatusPending=true;
 try{const r=await api('/api/thread-statuses',{ids:allThreads.map(t=>t.id)});threadIndicators.clear();for(const s of r.states)if(s.indicator)threadIndicators.set(s.id,s.indicator);}
 catch{threadIndicators.clear();}
 finally{threadStatusPending=false;updateThreadIndicators();}
}
setInterval(()=>{if(!document.hidden)refreshThreadIndicators();},3000);
function renderMessages(messages,prepend=false){
 const box=$('messages'),height=box.scrollHeight,nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;
 const finalIndexes=new Map();messages.forEach((m,index)=>{if(m.turnId&&m.role==='assistant'&&m.phase==='final_answer')finalIndexes.set(m.turnId,index);});
 const messageNode=m=>{
  const a=document.createElement('article');a.className='message '+m.role;
  if(m.role!=='user'){const role=document.createElement('small');role.textContent=m.phase==='commentary'?'CODEX · 过程':m.phase==='final_answer'?'CODEX · 最终回复':'CODEX · 回复';a.append(role);}
  const p=document.createElement('p');p.textContent=m.text;a.append(p);return a;
 };
 const nodes=[];
 for(let index=0;index<messages.length;){
  const m=messages[index],canFold=item=>item.role==='assistant'&&item.phase==='commentary'&&item.turnId===m.turnId&&index<finalIndexes.get(m.turnId);
  if(!canFold(m)){nodes.push(messageNode(m));index++;continue;}
  const details=document.createElement('details'),summary=document.createElement('summary'),group=[];
  const key=JSON.stringify([selected,m.turnId,m.id]);
  while(index<messages.length&&canFold(messages[index]))group.push(messages[index++]);
  details.className='process-messages';details.open=expandedProcesses.has(key);
  const label=()=>{summary.textContent=(details.open?'收起过程':'展开过程')+'（'+group.length+'）';};label();
  details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)expandedProcesses.add(key);else expandedProcesses.delete(key);label();});
  details.append(summary,...group.map(messageNode));nodes.push(details);
 }
 if(!nodes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='开始一段新对话';nodes.push(empty);}
 if(prepend){box.prepend(...nodes);box.scrollTop=box.scrollHeight-height;}else{box.replaceChildren(...nodes);if(nearBottom)box.scrollTop=box.scrollHeight;}
}
async function messages(older=false){const id=selected;if(!id||messageLoads.has(id))return;messageLoads.add(id);try{const r=await api('/api/messages?id='+encodeURIComponent(id)+(older&&olderCursor?'&cursor='+encodeURIComponent(olderCursor):''));if(selected!==id)return;if(older){hasOlderLoaded=true;history=[...r.messages,...history];}else {const ids=new Set(r.messages.map(m=>m.id));const first=history.findIndex(m=>ids.has(m.id));history=hasOlderLoaded&&first>=0?[...history.slice(0,first),...r.messages]:r.messages;}if(older||!hasOlderLoaded)olderCursor=r.nextCursor;$('older').hidden=!olderCursor;renderMessages(history);showQuestions(r.questions||[]);syncDesktopConnection(r.questionError);}finally{messageLoads.delete(id);}}
let questionKey='',blockingQuestion=false,desktopConnected=false,desktopConnectionAttempt=null;
function syncDesktopConnection(syncError){
 const connected=!syncError,wasConnected=desktopConnected;desktopConnected=connected;
 const notice=$('notice');
 if(!connected){
  if(!notice.textContent||notice.dataset.kind==='connection'){
   notice.dataset.kind='connection';notice.className='';notice.textContent=desktopConnectionAttempt?'正在连接桌面对话…':'桌面对话尚未连接，可点「在桌面打开」重试';
  }
  $('model').disabled=true;$('effort').disabled=true;return;
 }
 if(notice.dataset.kind==='connection'){notice.textContent='';delete notice.dataset.kind;}
 if(!wasConnected){
  const id=selected;
  (async()=>{await modelsReady;if(selected!==id)return;const settings=await api('/api/model?id='+encodeURIComponent(id));if(selected!==id||!desktopConnected)return;showModelSettings(settings);$('model').disabled=false;})().catch(e=>{if(selected===id){desktopConnected=false;error(e);}});
 }
}
function showQuestions(requests){
 const form=$('questions');blockingQuestion=requests.some(r=>r.isBlocking);
 $('send').disabled=blockingQuestion;$('text').disabled=blockingQuestion;
 $('text').placeholder=blockingQuestion?'请先回答上方的问题':'给这个对话发送消息…';
 const key=JSON.stringify([selected,requests]);if(key===questionKey)return;questionKey=key;
 form.replaceChildren();form.hidden=!requests.length;
 for(const request of requests){
  const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=request.isBlocking?'等待你回答':'Codex 提问';section.append(heading);
  const fields=[];
  for(const q of request.questions){
   const field=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=(q.header?q.header+' · ':'')+q.question;field.append(legend);
   const radios=[];
   for(const [i,option]of q.options.entries()){
    const label=document.createElement('label'),radio=document.createElement('input'),body=document.createElement('span'),title=document.createElement('span');
    radio.type='radio';radio.name=String(request.requestId)+'/'+q.id;radio.value=option.label;title.textContent=option.label;body.append(title);
    if(option.description){const detail=document.createElement('small');detail.textContent=option.description;body.append(detail);}
    label.className='question-option';label.append(radio,body);field.append(label);radios.push(radio);
   }
   const free=document.createElement('input');free.type=q.isSecret?'password':'text';free.placeholder=q.options.length?'或输入其他答案':'输入你的答案';free.setAttribute('aria-label',q.question+'：自定义答案');free.maxLength=16000;free.autocomplete='off';
   free.oninput=()=>{if(free.value)for(const radio of radios)radio.checked=false;};
   for(const radio of radios)radio.onchange=()=>{free.value='';};
   field.append(free);section.append(field);fields.push({q,radios,free});
  }
  const submit=document.createElement('button'),status=document.createElement('p');submit.type='button';submit.className='question-submit';submit.textContent='提交答案';status.className='question-status';status.setAttribute('role','status');section.append(submit,status);
  submit.onclick=async()=>{
   const id=selected,answers={};
   for(const {q,radios,free}of fields){const answer=free.value.trim()||radios.find(r=>r.checked)?.value;if(!answer){status.textContent='请回答每个问题';free.focus();return;}answers[q.id]={answers:[answer]};}
   submit.disabled=true;status.textContent='提交中…';
   try{await api('/api/questions/answer',{id,requestId:request.requestId,answers});if(selected!==id)return;status.textContent='答案已提交，正在同步…';await messages();}
   catch(e){if(selected===id){status.textContent=e.message;submit.disabled=false;}}
  };
  form.append(section);
 }
}
$('questions').onsubmit=e=>{e.preventDefault();$('questions').querySelector('.question-submit:not(:disabled)')?.click();};

let history=[],hasOlderLoaded=false;
async function select(t){
 const attempt={id:t.id};desktopConnectionAttempt=attempt;
 document.body.dataset.view='chat';$('messages').replaceChildren();
 if(selected){drafts.set(selected,$('text').value);attachmentDrafts.set(selected,[...selectedAttachments]);}
 selected=t.id;desktopConnected=false;questionKey='';$('questions').hidden=true;$('questions').replaceChildren();
 selectedAttachments=[...(attachmentDrafts.get(selected)||[])];renderAttachments();$('attach').disabled=false;$('downloadFiles').disabled=false;
 hasOlderLoaded=false;$('text').value=drafts.get(selected)||'';history=[];blockingQuestion=true;
 $('title').textContent=t.title;$('open').disabled=false;$('text').disabled=true;$('send').disabled=true;$('model').disabled=true;$('effort').disabled=true;
 $('notice').className='';$('notice').dataset.kind='connection';$('notice').textContent='正在连接桌面对话…';renderThreads();
 try{
  let openError;try{await api('/api/open',{id:t.id});}catch(e){openError=e;}
  for(let retry=0;retry<3;retry++){
   if(desktopConnectionAttempt!==attempt)return;
   await messages();
   if(desktopConnectionAttempt!==attempt)return;
   if(desktopConnected)break;
   if(retry<2)await new Promise(resolve=>setTimeout(resolve,600));
  }
  if(!desktopConnected&&openError)error(Object.assign(openError,{kind:'connection'}));
  if(selected===t.id)$('messages').scrollTop=$('messages').scrollHeight;
 }catch(e){if(desktopConnectionAttempt===attempt)error(e);}
 finally{if(desktopConnectionAttempt===attempt){desktopConnectionAttempt=null;if(!desktopConnected&&$('notice').dataset.kind==='connection'&&!$('notice').classList.contains('error'))$('notice').textContent='自动连接未成功，可点「在桌面打开」重试';}}
}
let limitsPending=null,limitsUpdatedAt=0;
function limits(){
 if(limitsPending)return limitsPending;
 limitsPending=(async()=>{
  $('refreshLimits').disabled=true;$('refreshLimits').textContent='刷新中…';
  try{
   for(let attempt=0;attempt<2;attempt++){
    try{
     const r=await api('/api/limits');
     const buckets=Object.values(r.rateLimitsByLimitId||{codex:r.rateLimits});$('limits').replaceChildren();for(const b of buckets.filter(Boolean)){const card=document.createElement('div');card.className='bucket';const h=document.createElement('h3');h.textContent=b.limitName||b.limitId||'Codex';card.append(h);for(const [key,label]of [['primary','短期额度'],['secondary','每周额度']]){const w=b[key];if(!w)continue;const p=document.createElement('p');p.textContent=`${label} · 剩余 ${Math.max(0,100-w.usedPercent)}% · ${w.windowDurationMins??'?'} 分钟窗口`;const progress=document.createElement('progress');progress.max=100;progress.setAttribute('aria-label',label+'剩余额度');progress.value=Math.max(0,100-w.usedPercent);const reset=document.createElement('p');reset.textContent='重置：'+(w.resetsAt?new Date(w.resetsAt*1000).toLocaleString():'未知');card.append(p,progress,reset);}if(b.credits){const p=document.createElement('p');p.textContent='积分：'+(b.credits.balance??'未知');card.append(p);}$('limits').append(card);}$('quotaTime').textContent='更新于 '+new Date().toLocaleTimeString();
     limitsUpdatedAt=Date.now();return;
    }catch(e){
     if(e.status===401)return;
     if(attempt===0){
      if(!limitsUpdatedAt)$('limits').textContent='暂时无法读取额度，正在自动重试…';
      else $('quotaTime').textContent='正在重试，暂显示上次额度';
      await new Promise(resolve=>setTimeout(resolve,1500));continue;
     }
     if(!limitsUpdatedAt){$('limits').textContent='额度暂不可用：'+e.message;$('quotaTime').textContent='未取得实时额度';}
     else $('quotaTime').textContent='更新失败，显示上次额度（'+new Date(limitsUpdatedAt).toLocaleTimeString()+'）：'+e.message;
    }
   }
  }finally{$('refreshLimits').disabled=false;$('refreshLimits').textContent='刷新';}
 })().finally(()=>{limitsPending=null;});
 return limitsPending;
}
$('quota').addEventListener('toggle',e=>{if(e.newState==='open'&&Date.now()-limitsUpdatedAt>60000)limits();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-limitsUpdatedAt>60000)limits();});

$('project').onchange=renderThreads;$('search').oninput=renderThreads;$('moreThreads').onclick=()=>threads(true).catch(error);$('older').onclick=()=>messages(true).catch(error);$('refreshLimits').onclick=limits;
$('open').onclick=()=>{const thread=allThreads.find(t=>t.id===selected);if(thread)select(thread);};
$('composer').onsubmit=async e=>{e.preventDefault();if(blockingQuestion)return;const text=$('text').value,id=selected,files=selectedAttachments.map(f=>f.path);if(!text.trim()&&!files.length)return;$('send').disabled=true;$('sendStatus').textContent='发送中…';try{await api('/api/send',{id,text,files});drafts.delete(id);const remaining=(attachmentDrafts.get(id)||[]).filter(f=>!files.includes(f.path));attachmentDrafts.set(id,remaining);if(selected===id){$('text').value='';selectedAttachments=selectedAttachments.filter(f=>!files.includes(f.path));renderAttachments();}$('sendStatus').textContent='';await messages();}catch(e){error(e);$('sendStatus').textContent=e.kind==='connection'?'':'请先核对历史，避免重复发送';}finally{$('send').disabled=blockingQuestion;}};
async function init(){const r=await api('/api/bootstrap');token=r.token;$('connection').textContent=r.ipcError?'桌面 IPC 不可用':'服务器已连接';$('notice').textContent='';for(const p of r.projects)addProject(p);await threads();limits();}
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
$('newThread').onclick=()=>{$('newProject').value=$('project').value;$('createStatus').textContent='';$('newDialog').showModal();document.dispatchEvent(new Event('choice:sync'));};
$('cancelNew').onclick=()=>$('newDialog').close();
$('newForm').onsubmit=async e=>{
  e.preventDefault();const projectId=$('newProject').value;
  $('confirmNew').disabled=true;$('cancelNew').disabled=true;$('createStatus').textContent='正在创建对话…';
  const preventClose=e=>e.preventDefault();$('newDialog').addEventListener('cancel',preventClose);
  try{
    const r=await api('/api/create',{projectId,model:$('newModel').value||undefined,effort:$('newEffort').value||undefined});
    $('project').value=projectId;$('search').value='';document.dispatchEvent(new Event('choice:sync'));
    allThreads=[r.thread,...allThreads.filter(t=>t.id!==r.thread.id)];
    $('newDialog').close();await select(r.thread);
    if(r.warning)$('notice').textContent=r.warning;
  }catch(e){$('createStatus').textContent=e.message+'；请先刷新列表确认是否已创建，避免重复创建。';}
  finally{$('confirmNew').disabled=false;$('cancelNew').disabled=false;$('newDialog').removeEventListener('cancel',preventClose);}
};

async function updateModelSettings(){
  const id=selected,model=$('model').value,effort=$('effort').value;if(!id||!model)return;
  $('model').disabled=true;$('effort').disabled=true;
  try{await api('/api/model',{id,model,effort});}
  catch(e){error(e);try{const settings=await api('/api/model?id='+id);if(selected===id)showModelSettings(settings);}catch{}}
  finally{if(selected===id){$('model').disabled=false;$('effort').disabled=!modelCatalog.find(m=>m.id===$('model').value)?.efforts?.length;}}
}
$('model').onchange=()=>{fillEfforts('effort',$('model').value,$('effort').value);updateModelSettings();};
$('effort').onchange=updateModelSettings;
$('newModel').onchange=()=>fillEfforts('newEffort',$('newModel').value,$('newEffort').value);

function addProject(project){
  projectCatalog=projectCatalog.filter(p=>p.id!==project.id);projectCatalog.push(project);
  for(const id of ['project','newProject']){let option=[...$(id).options].find(o=>o.value===project.id);if(!option){option=document.createElement('option');option.value=project.id;$(id).append(option);}option.textContent=project.name;}
}
function renderAttachments(){
  $('attachments').replaceChildren();
  for(const file of selectedAttachments){const chip=document.createElement('button');chip.type='button';chip.className='attachment-chip';chip.textContent='📎 '+file.name+' ×';chip.title=file.path;chip.setAttribute('aria-label','移除附件 '+file.name);chip.onclick=()=>{selectedAttachments=selectedAttachments.filter(f=>f.path!==file.path);attachmentDrafts.set(selected,[...selectedAttachments]);renderAttachments();};$('attachments').append(chip);}
}
let pickerMode='files',pickerPath='',pickerHome='',pickerItems=[],pickerSelection=new Map(),pickerCallback=null,pickerRequest=0;
function renderPicker(){
  const query=$('pickerSearch').value.toLowerCase();$('pickerEntries').replaceChildren();
  for(const item of pickerItems.filter(i=>($('showHidden').checked||!i.name.startsWith('.'))&&i.name.toLowerCase().includes(query))){
    if(item.directory){const row=document.createElement('button');row.type='button';row.className='picker-entry';row.textContent='▸ '+item.name;row.onclick=()=>loadDirectory(item.path);$('pickerEntries').append(row);}
    else if(pickerMode==='download'){const row=document.createElement('div');row.className='picker-entry download-row';const name=document.createElement('span');name.textContent=item.name;const button=document.createElement('button');button.type='button';button.textContent='下载';button.setAttribute('aria-label','下载 '+item.name);button.onclick=()=>startDownload(item,button);row.append(name,button);$('pickerEntries').append(row);}
    else {const row=document.createElement('label');row.className='picker-entry';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=pickerSelection.has(item.path);checkbox.setAttribute('aria-label','选择文件 '+item.name);const name=document.createElement('span');name.textContent=item.name;row.append(checkbox,name);checkbox.onchange=()=>{if(checkbox.checked){if(pickerSelection.size>=10){checkbox.checked=false;$('pickerStatus').textContent='一次最多附加 10 个文件';return;}pickerSelection.set(item.path,item);}else pickerSelection.delete(item.path);updatePickerSelection();};$('pickerEntries').append(row);}
  }
  if(!$('pickerEntries').childElementCount){const p=document.createElement('p');p.className='no-threads';p.textContent='没有匹配的项目';$('pickerEntries').append(p);}
}
function updatePickerSelection(){
  $('useSelection').hidden=pickerMode==='download';
  $('useSelection').disabled=pickerMode==='folders'?!pickerPath:!pickerSelection.size;
  $('useSelection').textContent=pickerMode==='folders'?'选择此文件夹':'附加所选文件（'+pickerSelection.size+'）';
}
async function loadDirectory(path){
  const request=++pickerRequest;$('pickerPath').disabled=true;$('goPath').disabled=true;$('pickerStatus').textContent='正在读取文件夹…';$('useSelection').disabled=true;$('pickerEntries').replaceChildren();
  try{const r=await api('/api/files/browse',{path,foldersOnly:pickerMode==='folders'});if(request!==pickerRequest||!$('filePicker').open)return;pickerPath=r.path;pickerHome=r.home;pickerItems=r.items;$('pickerPath').value=r.path;$('pickerUp').disabled=r.parent===r.path;$('pickerUp').dataset.path=r.parent;$('pickerSearch').value='';$('pickerStatus').textContent=r.truncated?'仅显示前 500 项，可输入更具体的文件夹路径。':'';renderPicker();updatePickerSelection();}
  catch(e){if(request===pickerRequest){$('pickerStatus').textContent=e.message;pickerPath='';$('useSelection').disabled=true;}}
  finally{if(request===pickerRequest){$('pickerPath').disabled=false;$('goPath').disabled=false;}}
}
function openPicker(mode,callback,files=[],startPath){
  pickerMode=mode;pickerCallback=callback;pickerSelection=new Map(files.map(f=>[f.path,f]));pickerPath='';$('useSelection').hidden=mode==='download';$('showHidden').checked=false;$('pickerTitle').textContent=mode==='folders'?'选择服务器文件夹':mode==='download'?'下载结果文件':'附加服务器文件';$('filePicker').showModal();
  const project=projectCatalog.find(p=>p.id===$('project').value);const thread=allThreads.find(t=>t.id===selected);
  loadDirectory(startPath||thread?.cwd||project?.roots?.[0]?.path||undefined);
}
$('closePicker').onclick=()=>$('filePicker').close();
$('filePicker').addEventListener('close',()=>{pickerRequest++;});
$('pathForm').onsubmit=e=>{e.preventDefault();loadDirectory($('pickerPath').value);};
$('pickerSearch').oninput=renderPicker;
$('showHidden').onchange=renderPicker;
$('pickerHome').onclick=()=>loadDirectory(pickerHome||undefined);
$('pickerVolumes').onclick=()=>loadDirectory('/Volumes');
$('pickerUp').onclick=()=>loadDirectory($('pickerUp').dataset.path);
$('useSelection').onclick=async()=>{
  if(pickerMode==='folders'){const path=pickerPath;$('filePicker').close();pickerCallback(path);return;}
  $('useSelection').disabled=true;const request=pickerRequest,callback=pickerCallback;
  try{const r=await api('/api/files/resolve',{paths:[...pickerSelection.keys()]});if(request!==pickerRequest||!$('filePicker').open)return;$('filePicker').close();callback(r.files);}catch(e){if(request===pickerRequest){$('pickerStatus').textContent=e.message;updatePickerSelection();}}
};
$('attachLocal').onclick=()=>{$('fileActions').hidePopover();openPicker('files',files=>{selectedAttachments=files;attachmentDrafts.set(selected,[...files]);renderAttachments();},selectedAttachments);};
let projectCreateKey='';
function openProjectDialog(){projectCreateKey=crypto.randomUUID();$('projectName').value='';$('projectFolder').value='';$('projectStatus').textContent='';$('projectDialog').showModal();}
$('newProjectButton').onclick=openProjectDialog;
$('newProjectFromThread').onclick=openProjectDialog;
$('cancelProject').onclick=()=>$('projectDialog').close();
$('chooseFolder').onclick=()=>openPicker('folders',path=>{$('projectFolder').value=path;if(!$('projectName').value)$('projectName').value=path.split('/').filter(Boolean).pop()||'项目';});
$('projectForm').onsubmit=async e=>{
  e.preventDefault();if(!$('projectFolder').value){$('projectStatus').textContent='请先选择服务器文件夹';return;}
  $('confirmProject').disabled=true;$('cancelProject').disabled=true;$('projectStatus').textContent='正在创建项目…';
  const preventClose=e=>e.preventDefault();$('projectDialog').addEventListener('cancel',preventClose);
  try{const r=await api('/api/projects/create',{name:$('projectName').value,path:$('projectFolder').value,key:projectCreateKey});addProject(r.project);$('project').value=r.project.id;$('newProject').value=r.project.id;$('search').value='';renderThreads();document.dispatchEvent(new Event('choice:sync'));$('projectNotice').hidden=false;$('projectNotice').textContent='项目已在网页中创建。桌面侧栏尚不能自动同步新增项目。';$('projectDialog').close();}
  catch(e){$('projectStatus').textContent=e.message;}
  finally{$('confirmProject').disabled=false;$('cancelProject').disabled=false;$('projectDialog').removeEventListener('cancel',preventClose);}
};

$('fileActions').addEventListener('beforetoggle',e=>{if(e.newState!=='open')return;const r=$('attach').getBoundingClientRect();$('fileActions').style.left=Math.max(12,Math.min(r.left,innerWidth-248))+'px';$('fileActions').style.top=Math.max(12,r.top-112)+'px';});
let uploadThread='',uploadQueue=[],uploading=false;
function renderUploadQueue(){
  $('uploadQueue').replaceChildren();
  for(const file of uploadQueue){const item=document.createElement('div');item.textContent=file.name+' · '+(file.size<1024?file.size+' B':file.size<1024*1024?(file.size/1024).toFixed(1)+' KB':(file.size/1024/1024).toFixed(1)+' MB');$('uploadQueue').append(item);}
  $('confirmUpload').disabled=uploading||!uploadQueue.length||!$('uploadFolder').value;
}
$('upload').onclick=()=>{
  $('fileActions').hidePopover();uploadThread=selected;uploadQueue=[];$('uploadFiles').value='';$('uploadStatus').textContent='';
  const thread=allThreads.find(t=>t.id===uploadThread),project=projectCatalog.find(p=>p.id===thread?.projectId);
  $('uploadFolder').value=thread?.cwd||project?.roots?.[0]?.path||'';renderUploadQueue();$('uploadDialog').showModal();
};
$('cancelUpload').onclick=()=>$('uploadDialog').close();
$('uploadDialog').addEventListener('cancel',e=>{if(uploading)e.preventDefault();});
$('chooseUploadFolder').onclick=()=>openPicker('folders',path=>{$('uploadFolder').value=path;renderUploadQueue();},[],$('uploadFolder').value);
$('chooseUploadFiles').onclick=()=>$('uploadFiles').click();
$('uploadFiles').onchange=()=>{
  const files=[...$('uploadFiles').files],attached=selected===uploadThread?selectedAttachments:attachmentDrafts.get(uploadThread)||[];
  if(files.length+attached.length>10){$('uploadStatus').textContent='当前消息的附件总数不能超过 10 个';uploadQueue=[];}
  else if(files.some(f=>f.size>50*1024*1024)){$('uploadStatus').textContent='单个文件不能超过 50 MB';uploadQueue=[];}
  else {uploadQueue=files;$('uploadStatus').textContent='';}renderUploadQueue();
};
$('uploadForm').onsubmit=async e=>{
  e.preventDefault();if(uploading||!uploadQueue.length||!$('uploadFolder').value)return;
  uploading=true;for(const id of ['cancelUpload','chooseUploadFolder','chooseUploadFiles','uploadFiles','confirmUpload'])$(id).disabled=true;
  const files=[...uploadQueue],folder=$('uploadFolder').value,id=uploadThread,failed=[];let completed=0;
  try{
    for(let i=0;i<files.length;i++){
      const file=files[i];$('uploadStatus').textContent='正在上传 '+(i+1)+' / '+files.length+'：'+file.name;
      try{
        const query=new URLSearchParams({id,folder,name:file.name});
        const response=await fetch('/api/files/upload?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Codexweb-Token':token},body:file});
        const result=await response.json();if(!response.ok)throw Error(result.error||'上传失败');
        const attached=id===selected?selectedAttachments:attachmentDrafts.get(id)||[];
        const next=[...attached,result.file];attachmentDrafts.set(id,next);if(selected===id){selectedAttachments=next;renderAttachments();}
        completed++;
      }catch(error){failed.push({file,error:error.message});}
    }
    uploadQueue=failed.map(f=>f.file);
    if(!failed.length){$('uploadDialog').close();if(selected===id)$('sendStatus').textContent='已上传并附加 '+completed+' 个文件，发送后即可使用';}
    else $('uploadStatus').textContent='已上传并附加 '+completed+' 个文件。'+failed.map(f=>f.file.name+'：'+f.error).join('；')+'。重试前可检查目标文件夹。';
  }finally{uploading=false;for(const control of ['cancelUpload','chooseUploadFolder','chooseUploadFiles','uploadFiles'])$(control).disabled=false;renderUploadQueue();}
};

enhanceChoices(['project','newProject','model','effort','newModel','newEffort'],(id,value)=>{
  if(id==='project'||id==='newProject')return value?projectCatalog.find(p=>p.id===value)?.roots?.map(r=>r.path).join(' · ')||'':id==='project'?'查看全部项目中的对话':'';
  if(id==='model'||id==='newModel')return value?modelCatalog.find(m=>m.id===value)?.description||'':'跟随 Codex 默认模型';
  return value?{none:'不使用额外思考',minimal:'最少的思考深度',low:'较少的思考深度',medium:'适中的思考深度',high:'更深入地思考',xhigh:'更高的思考深度',max:'最高的思考深度',ultra:'最高思考深度，可自动分派任务'}[value]||'':'使用所选模型的默认思考强度';
});

$('lock').onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.replace('/');};

async function startDownload(file,button){
  button.disabled=true;$('pickerStatus').textContent='正在准备下载：'+file.name;
  try{
    const url='/api/files/download?'+new URLSearchParams({path:file.path});
    const response=await fetch(url,{method:'HEAD'});
    if(response.status===401){location.replace('/');return;}
    if(!response.ok)throw Error('文件不存在或无法读取，请刷新文件夹后重试');
    const link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
    $('pickerStatus').textContent='已请求下载：'+file.name+'。请查看浏览器的下载列表。';
  }catch(e){$('pickerStatus').textContent=e.message;}
  finally{button.disabled=false;}
}
$('downloadFiles').onclick=()=>openPicker('download',null);
