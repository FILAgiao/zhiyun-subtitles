/* Progressive enhancement: all sections remain readable when this file is unavailable. */
(function(){'use strict';
 const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 if(!('IntersectionObserver' in window)||preference?.matches)return;
 const sections=[...document.querySelectorAll('.chapter-heading,.feature-row,.account-services-copy,.account-services-links')];let observer;
 function revealAll(){document.documentElement.classList.remove('motion-ready');for(const section of sections)section.removeAttribute('data-reveal');observer?.disconnect();}
 try{observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.dataset.reveal='shown';observer.unobserve(entry.target);}},{rootMargin:'0px 0px -24px 0px',threshold:.08});
  for(const section of sections){if(section.getBoundingClientRect().top<innerHeight-32)section.dataset.reveal='shown';else{section.dataset.reveal='pending';observer.observe(section);}}
  document.documentElement.classList.add('motion-ready');
  if(preference?.addEventListener)preference.addEventListener('change',event=>{if(event.matches)revealAll();});
  else preference?.addListener?.(event=>{if(event.matches)revealAll();});
  window.addEventListener('pageshow',event=>{if(event.persisted)revealAll();});
 }catch(_){revealAll();}
})();
