const input=document.getElementById('password'),button=document.getElementById('submit'),status=document.getElementById('status');
try{const theme=localStorage.getItem('codexweb-theme');if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;}catch{}
fetch('/auth/status').then(r=>r.json()).then(state=>{if(state.authenticated){location.replace('/');return;}if(!state.configured){status.textContent='尚未配置访问密码，请先配置密码哈希。';return;}input.disabled=false;button.disabled=false;status.textContent='';}).catch(()=>{status.textContent='无法连接，请刷新后重试。';});
document.getElementById('unlock').onsubmit=async e=>{
 e.preventDefault();button.disabled=true;input.disabled=true;status.textContent='正在验证…';
 try{const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})});const result=await response.json();if(!response.ok)throw Error(result.error||'验证失败');input.value='';location.replace('/');}
 catch(error){status.textContent=error.message;button.disabled=false;input.disabled=false;input.focus();input.select();}
};
