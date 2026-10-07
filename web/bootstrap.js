const q=new URLSearchParams(location.search);
const p=new URLSearchParams();
if(q.has('theme'))p.set('theme',q.get('theme'));
else if(q.has('job'))p.set('job',q.get('job'));
try {
 const res=await fetch(new URL('./api/v1/theme?'+p,location.href));
 if(!res.ok)throw new Error('Theme could not be loaded.');
 window.CHART_PLATFORM_THEME=await res.json();
 await import('./app.js'+new URL(import.meta.url).search);
}catch(e){document.getElementById('root').textContent=e.message;}
