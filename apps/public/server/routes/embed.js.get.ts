// Embeddable widget loader: `<script src="https://site/embed.js" data-lang="fr"></script>`
// inserts an auto-resizing iframe of /embed. Heights are taken from the frame's
// window rather than its origin, which changes once a custom domain redirects.
import { siteContext } from '../utils/site-context'
import { setCache } from '../utils/request'

const SCRIPT = `(function(){var s=document.currentScript;if(!s)return;var o=new URL(s.src).origin;var l=s.getAttribute('data-lang');var c=s.getAttribute('data-campaign');var p='/'+[l,c,'embed'].filter(Boolean).join('/');var f=document.createElement('iframe');f.src=o+p;f.title=s.getAttribute('data-title')||'Prayer campaign';f.loading='lazy';f.setAttribute('scrolling','no');f.style.cssText='width:100%;max-width:640px;border:0;height:200px;display:block;';s.parentNode.insertBefore(f,s.nextSibling);window.addEventListener('message',function(e){if(e.source!==f.contentWindow||!e.data||e.data.type!=='pt-embed-height')return;var h=Number(e.data.height);if(h>0&&h<5000)f.style.height=h+'px';});})();`

export default defineEventHandler((event) => {
  siteContext(event)
  setResponseHeader(event, 'content-type', 'application/javascript; charset=utf-8')
  setCache(event, 'public, max-age=3600, s-maxage=86400')
  return SCRIPT
})
