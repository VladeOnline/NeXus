const shell=document.getElementById('app-shell');
  const themeButton=document.getElementById('theme-toggle');
  function setTheme(theme){
    const light=theme==='claro';
    shell.classList.toggle('theme-light',light);
    document.getElementById('theme-icon-light').toggleAttribute('hidden',!light);
    document.getElementById('theme-icon-dark').toggleAttribute('hidden',light);
    themeButton.setAttribute('aria-label',light?'Cambiar a modo oscuro':'Cambiar a modo claro');
    themeButton.title=light?'Cambiar a modo oscuro':'Cambiar a modo claro';
    themeButton.setAttribute('aria-pressed',String(light));
  }
  let savedTheme='oscuro';
  try{savedTheme=sessionStorage.getItem('nexus-theme')==='claro'?'claro':'oscuro'}catch(e){}
  setTheme(savedTheme);
  themeButton.addEventListener('click',()=>{
    const next=shell.classList.contains('theme-light')?'oscuro':'claro';
    setTheme(next);
    try{sessionStorage.setItem('nexus-theme',next)}catch(e){}
  });
  const views=document.querySelectorAll('.view');
  const navButtons=document.querySelectorAll('.nav-link');
  const nav=document.getElementById('main-nav');
  const mobileToggle=document.getElementById('mobile-toggle');
  const input=document.getElementById('content-input');
  const messageMode=document.getElementById('mode-message');
  const linkMode=document.getElementById('mode-link');
  function showView(name){
    views.forEach(view=>view.classList.toggle('active',view.id==='view-'+name));
    navButtons.forEach(button=>{
      const active=button.dataset.view===(name==='resultado'?'analizar':name);
      button.classList.toggle('active',active);
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
    nav.classList.remove('open');
    mobileToggle.setAttribute('aria-expanded','false');
    mobileToggle.setAttribute('aria-label','Abrir menú');
    window.scrollTo({top:0,behavior:'instant'});
  }
  navButtons.forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
  mobileToggle.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    mobileToggle.setAttribute('aria-expanded',String(open));
    mobileToggle.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');
  });
  document.getElementById('home-cta').addEventListener('click',()=>showView('analizar'));
  function selectMode(mode){
    const isMessage=mode==='mensaje';
    messageMode.classList.toggle('active',isMessage);
    linkMode.classList.toggle('active',!isMessage);
    messageMode.setAttribute('aria-pressed',String(isMessage));
    linkMode.setAttribute('aria-pressed',String(!isMessage));
    document.getElementById('message-help').hidden=!isMessage;
    document.getElementById('link-help').hidden=isMessage;
    input.setAttribute('aria-describedby',isMessage?'message-help':'link-help');
    input.placeholder=isMessage?'Pega aquí el texto del mensaje sospechoso…':'Pega aquí el enlace sospechoso…';
  }
  messageMode.addEventListener('click',()=>selectMode('mensaje'));
  linkMode.addEventListener('click',()=>selectMode('enlace'));
  function resetAnalysis(){input.value='';selectMode('mensaje')}
  document.getElementById('clear-analysis').addEventListener('click',()=>{resetAnalysis();input.focus()});
  document.getElementById('analyze-submit').addEventListener('click',()=>showView('resultado'));
  document.getElementById('retry-analysis').addEventListener('click',()=>{resetAnalysis();showView('analizar')});
  document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{
    const category=button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});
    document.querySelectorAll('.case-card').forEach(card=>{card.hidden=category!=='todos'&&!card.dataset.category.split(' ').includes(category)});
  }));
  const reportForm=document.getElementById('report-form');
  const confirmation=document.getElementById('report-confirmation');
  reportForm.addEventListener('submit',event=>{
    event.preventDefault();
    if(!reportForm.reportValidity())return;
    reportForm.reset();
    reportForm.hidden=true;
    confirmation.classList.add('active');
  });
  document.getElementById('another-report').addEventListener('click',()=>{
    confirmation.classList.remove('active');
    reportForm.hidden=false;
    document.getElementById('report-type').focus();
  });
  if (window.lucide) {
    window.lucide.createIcons();
  } else {
    document.getElementById('icons-script').addEventListener('load', () => {
      if (window.lucide) window.lucide.createIcons();
    }, { once: true });
  }

// Pausa el fondo mientras la pestaña no está visible, sin temporizadores.
function syncAmbientMotion() {
  document.documentElement.classList.toggle('motion-paused', document.hidden);
}
document.addEventListener('visibilitychange', syncAmbientMotion);
syncAmbientMotion();
