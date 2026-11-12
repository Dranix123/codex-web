import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute,basename} from 'node:path';
import {pipeline} from 'node:stream/promises';

export async function downloadFile(req,res,path){
 if(typeof path!=='string'||!isAbsolute(path))throw Error('请选择有效的服务器文件');
 const file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const info=await file.stat();if(!info.isFile())throw Error('请选择文件，文件夹不能直接下载');
  const name=encodeURIComponent(basename(path)).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':info.size,'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else await pipeline(file.createReadStream(),res);
 }finally{await file.close().catch(()=>{});}
}
