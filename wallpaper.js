/* Membuat elemen wallpaper di dalam #stage + efek parallax halus mengikuti kursor / kemiringan HP. */
(function(){
 var st=document.getElementById('stage');if(!st)return;
 var w=document.createElement('div');w.id='wp';w.setAttribute('aria-hidden','true');
 var L=[ // [kelas, ukuran, kiri, atas, var warna, kedalaman parallax, durasi]
  ['b',60,-12,-18,'--b1',14,19],['b',52,58,-14,'--b3',20,23],['b',58,70,52,'--b2',-16,26],
  ['b',46,-8,62,'--b4',12,21],['b',34,36,40,'--b5',-10,17],
  ['s',21,76,-3,'',34,24],['s',13,-2,56,'',-28,20],['s',9,46,80,'',24,18]];
 L.forEach(function(o){
  var p=document.createElement('div');p.className='wp-p';p.dataset.k=o[5];
  p.style.cssText='left:'+o[2]+'vw;top:'+o[3]+'vh;width:'+o[1]+'vmax;height:'+o[1]+'vmax';
  var e=document.createElement('div');e.className='wp-'+o[0];e.style.cssText='width:100%;height:100%;--d:'+o[6]+'s'+(o[4]?';--c:var('+o[4]+')':'');
  p.appendChild(e);w.appendChild(p)});
 var g=document.createElement('div');g.className='wp-g';w.appendChild(g);
 st.insertBefore(w,st.firstChild);
 var ps=[].slice.call(w.querySelectorAll('.wp-p')),raf=0,mx=0,my=0;
 function go(){raf=0;ps.forEach(function(p){var k=+p.dataset.k;p.style.transform='translate('+(mx*k).toFixed(1)+'px,'+(my*k).toFixed(1)+'px)'})}
 function mv(x,y){mx=x;my=y;if(!raf)raf=requestAnimationFrame(go)}
 if(!matchMedia('(prefers-reduced-motion:reduce)').matches){
  addEventListener('pointermove',function(e){if(e.pointerType==='touch')return;mv(e.clientX/innerWidth-.5,e.clientY/innerHeight-.5)},{passive:true});
  addEventListener('deviceorientation',function(e){if(e.gamma==null)return;mv(Math.max(-1,Math.min(1,e.gamma/40))*.5,Math.max(-1,Math.min(1,(e.beta-45)/40))*.5)},{passive:true});
 }
})();
