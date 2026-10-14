// Enumerate every composer candidate on the page, so the driver can pick the
// VISIBLE one instead of querySelector's first match (which on chat.qianwen.com
// is a hidden mirror with z-index -1 that silently swallows every keystroke).
//   node lib/why-editors.mjs qwen

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
const SEL = {
  qwen: '[role=textbox], [contenteditable=true], textarea',
  deepseek: '[role=textbox], [contenteditable=true], textarea',
};
if (!SEL[key]) { process.stderr.write('usage: why-editors.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!tab) { console.error('no conversation tab'); process.exit(1); }

const session = await connect(tab);
try {
  const out = await evaluate(session, `(() => {
    const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll(${JSON.stringify(SEL[key])})].map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        i,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        slate: el.getAttribute('data-slate-editor') || '',
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        zIndex: cs.zIndex,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top), left: Math.round(r.left),
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0,
        text: norm(el.innerText || el.value || '').slice(0, 30),
      };
    });
  })()`);
  console.log(JSON.stringify(out, null, 2));
  console.log('viewport height:', await evaluate(session, 'window.innerHeight'));
} finally {
  session.close();
}
