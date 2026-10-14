// Ground truth for submitting a prompt: what does the composer's neighbourhood
// actually contain, and which element is the real send control?
//   node lib/why-send.mjs qwen

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
const COMPOSER = {
  qwen: '[role=textbox][contenteditable=true]',
  deepseek: 'textarea[placeholder]',
};
if (!COMPOSER[key]) { process.stderr.write('usage: why-send.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!tab) { console.error('no conversation tab'); process.exit(1); }

const session = await connect(tab);
try {
  const out = await evaluate(session, `(() => {
    const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
    const composer = document.querySelector(${JSON.stringify(COMPOSER[key])});
    if (!composer) return { error: 'no composer' };

    const desc = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 60),
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        text: norm(el.innerText).slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };

    // Walk up from the composer and collect every button in that subtree.
    const found = [];
    let node = composer;
    for (let depth = 0; depth < 8 && node; depth++) {
      const buttons = [...node.querySelectorAll('button, [role=button]')];
      if (buttons.length) {
        found.push({ depth, cls: String(node.className || '').slice(0, 50), buttons: buttons.map(desc) });
        if (found.length >= 3) break;
      }
      node = node.parentElement;
    }
    return { composer: desc(composer), levels: found };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} finally {
  session.close();
}
