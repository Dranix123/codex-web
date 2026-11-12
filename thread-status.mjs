import {createHash} from 'node:crypto';

// Desktop sidebar: input/approval and errors take priority over working/unread.
export function threadIndicator(state,unread){
 const runtime=state?.threadRuntimeStatus;
 if(runtime?.type==='systemError'||runtime?.activeFlags?.some(flag=>flag==='waitingOnUserInput'||flag==='waitingOnApproval'))return null;
 if(runtime?.type==='active')return 'running';
 return (unread??state?.hasUnreadTurn)?'unread':null;
}

// Keep only sidebar fields from the native version 11 snapshot/Immer patch stream.
export function applyThreadStatusChange(current,change){
 if(change.type==='snapshot')return {revision:change.revision,threadRuntimeStatus:structuredClone(change.conversationState.threadRuntimeStatus),hasUnreadTurn:change.conversationState.hasUnreadTurn};
 if(change.type!=='patches'||!current||current.revision!==change.baseRevision)return null;
 const next=structuredClone(current);next.revision=change.revision;
 for(const patch of change.patches){
  if(!['threadRuntimeStatus','hasUnreadTurn'].includes(patch.path[0]))continue;
  let target=next;
  for(const key of patch.path.slice(0,-1)){target=target?.[key];if(target==null)break;}
  if(target==null)continue;
  const key=patch.path.at(-1);
  if(Array.isArray(target)){
   const index=key==='-'?target.length:Number(key);
   if(patch.op==='add')target.splice(index,0,patch.value);
   else if(patch.op==='remove')target.splice(index,1);
   else target[index]=patch.value;
  }else if(patch.op==='remove')delete target[key];else target[key]=structuredClone(patch.value);
 }
 return next;
}

export function desktopUnreadIds(globalState,context){
 const identities=globalState['electron-thread-read-state-v1']?.unreadByIdentity||{};
 let hosts,hostKey=context?.executionHostKey;
 if(context?.identity){
  const i=context.identity,key=createHash('sha256').update(JSON.stringify(i.kind==='chatgpt'?[i.kind,i.accountId,i.userId]:[i.kind,i.authMode])).digest('hex');
  hosts=identities[key];
 }else if(Object.keys(identities).length===1){
  hosts=Object.values(identities)[0];const local=Object.keys(hosts).filter(key=>key.startsWith('local:'));if(local.length===1)hostKey=local[0];
 }
 return hosts&&hostKey?new Set(hosts[hostKey]||[]):null;
}
