function enhanceChoices(ids,detail){
  const chevron='<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 6 3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const folder='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h4l2 2h6A1.5 1.5 0 0 1 17.5 8v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15Z" stroke="currentColor" stroke-width="1.4"/></svg>';
  const controls=[];
  const popup=document.createElement('div');popup.id='choiceMenu';popup.className='choice-menu';popup.setAttribute('popover','auto');
  const heading=document.createElement('div');heading.className='choice-menu-heading';
  const search=document.createElement('input');search.type='search';search.className='choice-search';search.placeholder='搜索项目';search.setAttribute('aria-label','搜索项目选项');
  const list=document.createElement('div');list.className='choice-options';list.setAttribute('role','listbox');
  const footer=document.createElement('div');footer.className='choice-menu-footer';
  popup.append(heading,search,list,footer);document.body.append(popup);
  let active=null;
  function sync(){
    for(const c of controls){const option=c.select.selectedOptions[0];c.text.textContent=option?.textContent||c.label;c.button.disabled=c.select.disabled;c.button.setAttribute('aria-label',c.label+'：'+c.text.textContent);}
    if(active?.button.disabled&&popup.matches(':popover-open'))popup.hidePopover();
  }
  function position(){
    if(!active||!popup.matches(':popover-open'))return;
    const rect=active.button.getBoundingClientRect(),width=window.visualViewport?.width||innerWidth,height=window.visualViewport?.height||innerHeight;
    const above=rect.top-12,below=height-rect.bottom-12,up=above>below;
    popup.style.width=Math.min(active.project?360:340,width-24)+'px';
    popup.style.maxHeight=Math.max(100,Math.min(480,up?above:below))+'px';
    popup.style.left=Math.max(12,Math.min(rect.left,width-popup.getBoundingClientRect().width-12))+'px';
    popup.style.top=(up?Math.max(12,rect.top-popup.getBoundingClientRect().height-8):rect.bottom+8)+'px';
  }
  function render(){
    list.replaceChildren();if(!active)return;
    const query=search.value.trim().toLowerCase();
    for(const option of active.select.options){
      if(option.disabled||(active.select.id==='model'&&!option.value))continue;
      const description=detail(active.select.id,option.value)||option.title||'';
      if(query&&!(option.textContent+' '+description).toLowerCase().includes(query))continue;
      const row=document.createElement('button');row.type='button';row.className='choice-option';row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.tabIndex=option.selected?0:-1;
      const content=document.createElement('span');content.className='choice-option-content';const title=document.createElement('span');title.className='choice-option-title';title.textContent=option.textContent;content.append(title);
      if(description){const sub=document.createElement('span');sub.className='choice-option-detail';sub.textContent=description;content.append(sub);}
      const mark=document.createElement('span');mark.className='choice-check';mark.textContent=option.selected?'✓':'';mark.setAttribute('aria-hidden','true');
      row.append(content,mark);
      row.onclick=()=>{const c=active;popup.hidePopover();c.button.focus({preventScroll:true});c.select.value=option.value;sync();c.select.dispatchEvent(new Event('change',{bubbles:true}));};
      list.append(row);
    }
    if(!list.children.length){const empty=document.createElement('p');empty.className='choice-empty';empty.textContent='没有匹配的项目';list.append(empty);}
  }
  function open(control){
    if(popup.matches(':popover-open')){const same=active===control;popup.hidePopover();if(same)return;}
    for(const c of controls)c.button.setAttribute('aria-expanded','false');
    active=control;(control.button.closest('dialog')||document.body).append(popup);
    heading.textContent=control.project?'选择项目':control.effort?'思考强度':'选择模型';list.setAttribute('aria-label',heading.textContent);
    search.hidden=!control.project;search.value='';footer.hidden=control.project||control.select.id.startsWith('new');footer.textContent='应用于下一条消息';
    render();popup.showPopover();control.button.setAttribute('aria-expanded','true');position();
    const selected=list.querySelector('[aria-selected="true"]');selected?.scrollIntoView({block:'nearest'});
    if(innerWidth>760&&control.project)search.focus({preventScroll:true});else (selected||list.querySelector('button'))?.focus({preventScroll:true});
  }
  popup.addEventListener('toggle',e=>{if(e.newState==='closed')for(const c of controls)c.button.setAttribute('aria-expanded','false');});
  popup.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();popup.hidePopover();active?.button.focus({preventScroll:true});return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||((e.key==='Home'||e.key==='End')&&e.target===search))return;
    const options=[...list.querySelectorAll('button')];if(!options.length)return;e.preventDefault();
    const index=options.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?options.length-1:e.key==='ArrowDown'?(index+1)%options.length:(index-1+options.length)%options.length;options[next].focus();
  });
  search.oninput=()=>{render();position();};
  for(const id of ids){
    const select=document.getElementById(id),project=id==='project'||id==='newProject',effort=id==='effort'||id==='newEffort';
    const label=select.getAttribute('aria-label')||select.labels?.[0]?.textContent||id;
    const wrapper=document.createElement('span');wrapper.className='choice-control'+(id==='model'||id==='effort'?' choice-compact':'');wrapper.dataset.select=id;
    const button=document.createElement('button');button.type='button';button.id=id+'Choice';button.className='choice-trigger';button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',popup.id);
    if(project){const icon=document.createElement('span');icon.className='choice-folder';icon.innerHTML=folder;button.append(icon);}
    const text=document.createElement('span');text.className='choice-current';const arrow=document.createElement('span');arrow.className='choice-chevron';arrow.innerHTML=chevron;button.append(text,arrow);wrapper.append(button);select.after(wrapper);
    for(const label of [...select.labels])label.htmlFor=button.id;
    select.hidden=true;if(select.required){select.required=false;button.setAttribute('aria-required','true');}
    const control={select,button,text,label,project,effort};controls.push(control);button.onclick=()=>open(control);
    button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(control);}};
    select.addEventListener('change',sync);
    new MutationObserver(sync).observe(select,{attributes:true,childList:true,subtree:true,characterData:true});
  }
  window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
  document.addEventListener('choice:sync',sync);sync();
}
