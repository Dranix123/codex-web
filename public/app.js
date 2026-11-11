const $=id=>document.getElementById(id);
const drafts=new Map(),attachmentDrafts=new Map();
let projectCatalog=[],selectedAttachments=[];
let token='',allThreads=[],threadCursor=null,selected='',olderCursor=null,polling=false,loading=false;
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Codexweb-Token':token},body:JSON.stringify(body)}:{});const x=await r.json();if(!r.ok)throw Error(x.error);return x;}
function error(e){$('notice').textContent=e.message;$('notice').className='error';}
function renderThreads(){const project=$('project').value,q=$('search').value.toLowerCase();$('threads').replaceChildren();for(const t of allThreads.filter(t=>(!project||t.projectId===project)&&t.title.toLowerCase().includes(q))){const b=document.createElement('button'),title=document.createElement('span');title.className='thread-title';title.textContent=t.title.slice(0,70);b.append(title);b.className=t.id===selected?'active':'';b.setAttribute('aria-current',t.id===selected?'true':'false');b.onclick=()=>select(t);$('threads').append(b);}if(!$('threads').childElementCount){const p=document.createElement('p');p.className='no-threads';p.textContent='没有匹配的对话';$('threads').append(p);}}
async function threads(append=false){const r=await api('/api/threads'+(append&&threadCursor?'?cursor='+encodeURIComponent(threadCursor):''));allThreads=append?[...allThreads,...r.data]:r.data;threadCursor=r.nextCursor;$('moreThreads').hidden=!threadCursor;renderThreads();}
function renderMessages(messages,prepend=false){const box=$('messages'),height=box.scrollHeight,nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;const nodes=messages.map(m=>{const a=document.createElement('article');a.className='message '+m.role;const role=document.createElement('small');role.textContent=m.role==='user'?'你':'CODEX';const p=document.createElement('p');p.textContent=m.text;a.append(role,p);return a;});if(!nodes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='开始一段新对话';nodes.push(empty);}if(prepend){box.prepend(...nodes);box.scrollTop=box.scrollHeight-height;}else{box.replaceChildren(...nodes);if(nearBottom)box.scrollTop=box.scrollHeight;}}
async function messages(older=false){const id=selected;if(!id||loading)return;loading=true;try{const r=await api('/api/messages?id='+encodeURIComponent(id)+(older&&olderCursor?'&cursor='+encodeURIComponent(olderCursor):''));if(selected!==id)return;if(older){hasOlderLoaded=true;history=[...r.messages,...history];}else {const ids=new Set(r.messages.map(m=>m.id));const first=history.findIndex(m=>ids.has(m.id));history=hasOlderLoaded&&first>=0?[...history.slice(0,first),...r.messages]:r.messages;}if(older||!hasOlderLoaded)olderCursor=r.nextCursor;$('older').hidden=!olderCursor;renderMessages(history);}finally{loading=false;}}
let history=[],hasOlderLoaded=false;
async function select(t){document.body.dataset.view='chat';$('messages').replaceChildren();if(selected){drafts.set(selected,$('text').value);attachmentDrafts.set(selected,[...selectedAttachments]);}selected=t.id;selectedAttachments=[...(attachmentDrafts.get(selected)||[])];renderAttachments();$('attach').disabled=false;hasOlderLoaded=false;$('text').value=drafts.get(selected)||'';history=[];$('title').textContent=t.title;$('open').disabled=false;$('text').disabled=false;$('send').disabled=true;$('model').disabled=true;$('effort').disabled=true;$('notice').className='';$('notice').textContent='正在检查桌面会话…';renderThreads();try{await messages();$('messages').scrollTop=$('messages').scrollHeight;for(let attempt=0;attempt<2;attempt++){try{await api('/api/owner?id='+t.id);break;}catch(e){if(attempt===1)throw e;await new Promise(resolve=>setTimeout(resolve,600));if(selected!==t.id)return;}}if(selected!==t.id)return;$('notice').textContent='已连接桌面会话 · 每 3 秒同步纯文本；消息会直接发送。';$('send').disabled=false;const settings=await api('/api/model?id='+t.id);if(selected===t.id){await modelsReady;if(selected!==t.id)return;showModelSettings(settings);$('model').disabled=false;}}catch(e){if(selected===t.id)$('notice').textContent='请先在桌面 App 打开这个对话，再点「在桌面打开」重试连接。';}}
async function limits(){try{const r=await api('/api/limits'),buckets=Object.values(r.rateLimitsByLimitId||{codex:r.rateLimits});$('limits').replaceChildren();for(const b of buckets.filter(Boolean)){const card=document.createElement('div');card.className='bucket';const h=document.createElement('h3');h.textContent=b.limitName||b.limitId||'Codex';card.append(h);for(const [key,label]of [['primary','短期额度'],['secondary','每周额度']]){const w=b[key];if(!w)continue;const p=document.createElement('p');p.textContent=`${label} · 剩余 ${Math.max(0,100-w.usedPercent)}% · ${w.windowDurationMins??'?'} 分钟窗口`;const progress=document.createElement('progress');progress.max=100;progress.setAttribute('aria-label',label+'剩余额度');progress.value=Math.max(0,100-w.usedPercent);const reset=document.createElement('p');reset.textContent='重置：'+(w.resetsAt?new Date(w.resetsAt*1000).toLocaleString():'未知');card.append(p,progress,reset);}if(b.credits){const p=document.createElement('p');p.textContent='积分：'+(b.credits.balance??'未知');card.append(p);}$('limits').append(card);}$('quotaTime').textContent='更新于 '+new Date().toLocaleTimeString();}catch(e){$('limits').textContent='额度暂不可用：'+e.message;$('quotaTime').textContent='未取得实时额度';}}
$('project').onchange=renderThreads;$('search').oninput=renderThreads;$('moreThreads').onclick=()=>threads(true).catch(error);$('older').onclick=()=>messages(true).catch(error);$('refreshLimits').onclick=limits;
$('open').onclick=async()=>{try{await api('/api/open',{id:selected});const thread=allThreads.find(t=>t.id===selected);if(thread)await select(thread);}catch(e){error(e);}};
$('composer').onsubmit=async e=>{e.preventDefault();const text=$('text').value,id=selected,files=selectedAttachments.map(f=>f.path);if(!text.trim()&&!files.length)return;$('send').disabled=true;$('sendStatus').textContent='发送中…';try{await api('/api/send',{id,text,files});drafts.delete(id);const remaining=(attachmentDrafts.get(id)||[]).filter(f=>!files.includes(f.path));attachmentDrafts.set(id,remaining);if(selected===id){$('text').value='';selectedAttachments=selectedAttachments.filter(f=>!files.includes(f.path));renderAttachments();}$('sendStatus').textContent='已交给桌面 App';await messages();}catch(e){error(e);$('sendStatus').textContent='请先核对历史，避免重复发送';}finally{$('send').disabled=false;}};
async function init(){const r=await api('/api/bootstrap');token=r.token;$('connection').textContent=r.ipcError?'桌面 IPC 不可用':'本机已连接';$('notice').textContent=r.notice;for(const p of r.projects)addProject(p);await threads();limits();}
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
    else {const row=document.createElement('label');row.className='picker-entry';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=pickerSelection.has(item.path);checkbox.setAttribute('aria-label','选择文件 '+item.name);const name=document.createElement('span');name.textContent=item.name;row.append(checkbox,name);checkbox.onchange=()=>{if(checkbox.checked){if(pickerSelection.size>=10){checkbox.checked=false;$('pickerStatus').textContent='一次最多附加 10 个文件';return;}pickerSelection.set(item.path,item);}else pickerSelection.delete(item.path);updatePickerSelection();};$('pickerEntries').append(row);}
  }
  if(!$('pickerEntries').childElementCount){const p=document.createElement('p');p.className='no-threads';p.textContent='没有匹配的项目';$('pickerEntries').append(p);}
}
function updatePickerSelection(){
  $('useSelection').disabled=pickerMode==='folders'?!pickerPath:!pickerSelection.size;
  $('useSelection').textContent=pickerMode==='folders'?'选择此文件夹':'附加所选文件（'+pickerSelection.size+'）';
}
async function loadDirectory(path){
  const request=++pickerRequest;$('pickerPath').disabled=true;$('goPath').disabled=true;$('pickerStatus').textContent='正在读取文件夹…';$('useSelection').disabled=true;$('pickerEntries').replaceChildren();
  try{const r=await api('/api/files/browse',{path,foldersOnly:pickerMode==='folders'});if(request!==pickerRequest||!$('filePicker').open)return;pickerPath=r.path;pickerHome=r.home;pickerItems=r.items;$('pickerPath').value=r.path;$('pickerUp').disabled=r.parent===r.path;$('pickerUp').dataset.path=r.parent;$('pickerSearch').value='';$('pickerStatus').textContent=r.truncated?'仅显示前 500 项，可输入更具体的文件夹路径。':pickerMode==='folders'?($('uploadDialog').open?'上传文件将保存到此文件夹。':'选择后会使用此文件夹创建项目。'):'文件作为本机引用发送，图片作为图片输入。';renderPicker();updatePickerSelection();}
  catch(e){if(request===pickerRequest){$('pickerStatus').textContent=e.message;pickerPath='';$('useSelection').disabled=true;}}
  finally{if(request===pickerRequest){$('pickerPath').disabled=false;$('goPath').disabled=false;}}
}
function openPicker(mode,callback,files=[],startPath){
  pickerMode=mode;pickerCallback=callback;pickerSelection=new Map(files.map(f=>[f.path,f]));pickerPath='';$('showHidden').checked=false;$('pickerTitle').textContent=mode==='folders'?'选择本机文件夹':'附加本机文件';$('filePicker').showModal();
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
function openProjectDialog(){projectCreateKey=crypto.randomUUID();$('projectName').value='';$('projectFolder').value='';$('projectStatus').textContent='使用已有文件夹创建 Codex 项目。';$('projectDialog').showModal();}
$('newProjectButton').onclick=openProjectDialog;
$('newProjectFromThread').onclick=openProjectDialog;
$('cancelProject').onclick=()=>$('projectDialog').close();
$('chooseFolder').onclick=()=>openPicker('folders',path=>{$('projectFolder').value=path;if(!$('projectName').value)$('projectName').value=path.split('/').filter(Boolean).pop()||'项目';});
$('projectForm').onsubmit=async e=>{
  e.preventDefault();if(!$('projectFolder').value){$('projectStatus').textContent='请先选择本机文件夹';return;}
  $('confirmProject').disabled=true;$('cancelProject').disabled=true;$('projectStatus').textContent='正在创建项目…';
  const preventClose=e=>e.preventDefault();$('projectDialog').addEventListener('cancel',preventClose);
  try{const r=await api('/api/projects/create',{name:$('projectName').value,path:$('projectFolder').value,key:projectCreateKey});addProject(r.project);$('project').value=r.project.id;$('newProject').value=r.project.id;$('search').value='';renderThreads();$('projectNotice').hidden=false;$('projectNotice').textContent='项目已在网页中创建。桌面侧栏尚不能自动同步新增项目。';$('projectDialog').close();}
  catch(e){$('projectStatus').textContent=e.message;}
  finally{$('confirmProject').disabled=false;$('cancelProject').disabled=false;$('projectDialog').removeEventListener('cancel',preventClose);}
};

$('fileActions').addEventListener('beforetoggle',e=>{if(e.newState!=='open')return;const r=$('attach').getBoundingClientRect();$('fileActions').style.left=Math.max(12,Math.min(r.left,innerWidth-248))+'px';$('fileActions').style.top=Math.max(12,r.top-108)+'px';});
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
