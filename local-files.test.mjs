import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browseDirectory,resolveDirectory,resolveAttachments,attachmentInput,saveUpload} from './local-files.mjs';

test('本机文件选择：区分目录和文件，解析符号链接并拒绝失效附件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codexweb-files-'));
 try{
  await mkdir(join(root,'目录'));await writeFile(join(root,'文本.txt'),'fixture');
  await symlink(join(root,'文本.txt'),join(root,'alias.txt'));
  const folders=await browseDirectory(root,true);assert.deepEqual(folders.items.map(e=>e.name),['目录']);
  const files=await resolveAttachments([join(root,'文本.txt'),join(root,'alias.txt')]);assert.equal(files.length,1);assert.equal(files[0].path,await realpath(join(root,'文本.txt')));
  await assert.rejects(resolveDirectory(join(root,'文本.txt')),/文件夹/);
  await assert.rejects(resolveAttachments([join(root,'目录')]),/不能是文件夹/);
  await assert.rejects(resolveAttachments([join(root,'missing.txt')]));
  await assert.rejects(resolveAttachments(['relative.txt']),/有效/);
  await assert.rejects(resolveAttachments(Array(11).fill(join(root,'文本.txt'))),/最多/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('图片使用原生图片输入，其他文件保留本机路径引用',()=>{
 assert.deepEqual(attachmentInput([{name:'图.png',path:'/tmp/图.png'},{name:'报告.pdf',path:'/tmp/报告.pdf'}]),[{type:'localImage',path:'/tmp/图.png'},{type:'mention',name:'报告.pdf',path:'/tmp/报告.pdf'},{type:'text',text:'本机文件引用（可使用本机工具读取）：\n/tmp/报告.pdf',text_elements:[]}]);
});

test('上传保留二进制内容，拒绝路径穿越，同名文件和符号链接不覆盖',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codexweb-upload-'));
 try{
  const bytes=Buffer.from([0,255,13,10,128]);
  const first=await saveUpload(root,'上传.bin',[bytes.subarray(0,2),bytes.subarray(2)]);
  assert.deepEqual(await readFile(first.path),bytes);
  const second=await saveUpload(root,'上传.bin',[Buffer.from('second')]);
  assert.equal(second.name,'上传 (1).bin');assert.deepEqual(await readFile(first.path),bytes);
  await symlink(first.path,join(root,'link.bin'));
  const link=await saveUpload(root,'link.bin',[Buffer.from('third')]);assert.equal(link.name,'link (1).bin');assert.deepEqual(await readFile(first.path),bytes);
  for(const name of ['../outside.txt','folder/file.txt','folder\\file.txt','..','bad\0.txt'])await assert.rejects(saveUpload(root,name,[]),/无效文件名/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('上传中断会删除部分写入的文件',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codexweb-upload-abort-'));
 try{
  async function* broken(){yield Buffer.from('partial');throw Error('connection lost');}
  await assert.rejects(saveUpload(root,'interrupted.txt',broken()),/connection lost/);
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
