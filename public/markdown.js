const markdownRenderer=new window.markdownit({html:false,linkify:true});
// Keep image references as links in the text conversation view.
markdownRenderer.renderer.rules.image=(tokens,index,options,env,self)=>{
 const token=tokens[index],src=token.attrGet('src')||'',label=markdownRenderer.utils.escapeHtml(self.renderInlineAsText(token.children||[],options,env)||'图片');
 return /^data:/i.test(src)?label:'<a href="'+markdownRenderer.utils.escapeHtml(src)+'">'+label+'</a>';
};
// Use classes instead of inline styles under the app's Content Security Policy.
for(const name of ['th_open','td_open'])markdownRenderer.renderer.rules[name]=(tokens,index,options,env,self)=>{
 const token=tokens[index],align=token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1];
 if(align){token.attrs=token.attrs.filter(([name])=>name!=='style');token.attrSet('class','align-'+align);}
 return self.renderToken(tokens,index,options);
};
function renderMarkdown(text){
 const body=document.createElement('div');body.className='markdown-body';body.innerHTML=markdownRenderer.render(text);
 for(const link of body.querySelectorAll('a[href]'))if(/^(https?:)?\/\//i.test(link.getAttribute('href'))){link.target='_blank';link.rel='noopener noreferrer';}
 for(const table of body.querySelectorAll('table')){
  const wrap=document.createElement('div');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格');table.before(wrap);wrap.append(table);
 }
 return body;
}
