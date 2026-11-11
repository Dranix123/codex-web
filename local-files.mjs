import {readdir,realpath,stat,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join,dirname,basename,extname} from 'node:path';

export async function resolveDirectory(path){
 if(typeof path!=='string'||!isAbsolute(path))throw Error('请输入本机文件夹的绝对路径');
 const resolved=await realpath(path);
 if(!(await stat(resolved)).isDirectory())throw Error('请选择文件夹');
 return resolved;
}
export async function browseDirectory(path=homedir(),foldersOnly=false){
 const directory=await resolveDirectory(path);
 const entries=await readdir(directory,{withFileTypes:true});
 const items=(await Promise.all(entries.map(async e=>{
  let folder=e.isDirectory(),file=e.isFile();
  if(e.isSymbolicLink()){try{const s=await stat(join(directory,e.name));folder=s.isDirectory();file=s.isFile();}catch{return null;}}
  return (folder||file)&&(!foldersOnly||folder)?{name:e.name,path:join(directory,e.name),directory:folder}:null;
 }))).filter(Boolean).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN'));
 return {path:directory,parent:dirname(directory),home:homedir(),items:items.slice(0,500),truncated:items.length>500};
}
export async function resolveAttachments(paths=[]){
 if(!Array.isArray(paths)||paths.length>10)throw Error('一次最多附加 10 个本机文件');
 const files=[];
 for(const path of paths){
  if(typeof path!=='string'||!isAbsolute(path))throw Error('请选择有效的本机文件');
  const resolved=await realpath(path);
  if(!(await stat(resolved)).isFile())throw Error('附件必须是文件，不能是文件夹');
  if(!files.some(f=>f.path===resolved))files.push({name:basename(resolved),path:resolved});
 }
 return files;
}
export function attachmentInput(files){
 const inputs=files.map(file=>/\.(png|jpe?g|webp|gif)$/i.test(extname(file.path))?{type:'localImage',path:file.path}:{type:'mention',name:file.name,path:file.path});
 // Native mention items retain a label but do not expose file paths to the model.
 const references=inputs.filter(input=>input.type==='mention');
 if(references.length)inputs.push({type:'text',text:'本机文件引用（可使用本机工具读取）：\n'+references.map(file=>file.path).join('\n'),text_elements:[]});
 return inputs;
}

export const MAX_UPLOAD_BYTES=50*1024*1024;
export async function saveUpload(directory,name,source){
 if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\\/\x00-\x1f\x7f]/.test(name)||Buffer.byteLength(name)>220)throw Error('无效文件名或文件名过长');
 const folder=await resolveDirectory(directory),extension=extname(name),stem=name.slice(0,name.length-extension.length);
 let file,path,savedName;
 for(let i=0;i<1000;i++){
  savedName=i?stem+' ('+i+')'+extension:name;path=join(folder,savedName);
  try{file=await open(path,'wx',0o600);break;}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 if(!file)throw Error('同名文件过多，请更改文件名');
 let size=0;
 try{
  for await(const chunk of source){size+=chunk.length;if(size>MAX_UPLOAD_BYTES)throw Error('单个文件不能超过 50 MB');await file.writeFile(chunk);}
  await file.close();return {name:savedName,path,size};
 }catch(e){await file.close().catch(()=>{});await unlink(path).catch(()=>{});throw e;}
}
