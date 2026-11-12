export class SendReceipts {
 confirmed=new Map();pending=new Map();
 async send(clientId,threadId,action){
  if(!clientId)return action();
  if(this.confirmed.has(clientId)){if(this.confirmed.get(clientId)!==threadId)throw Error('消息标识已用于其他对话');return;}
  if(this.pending.has(clientId)){const p=this.pending.get(clientId);if(p.threadId!==threadId)throw Error('消息标识已用于其他对话');return p.promise;}
  const promise=Promise.resolve().then(action).then(()=>{this.confirmed.set(clientId,threadId);if(this.confirmed.size>200)this.confirmed.delete(this.confirmed.keys().next().value);}).finally(()=>this.pending.delete(clientId));
  this.pending.set(clientId,{threadId,promise});return promise;
 }
 forThread(id){return [...this.confirmed].filter(([,threadId])=>threadId===id).map(([clientId])=>clientId);}
}
