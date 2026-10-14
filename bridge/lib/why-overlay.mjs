// What is actually on top of the composer? Reports the topmost element at the
// composer's centre, so an overlay/dialog intercepting clicks is visible
// instead of guessed at.
//   node lib/why-overlay.mjs qwen

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
if (key !== 'qwen') { process.stderr.write('usage: why-overlay.mjs qwen\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!tab) { console.error('no conversation tab'); process.exit(1); }

const session = await connect(tab);
try {
  const out = await evaluate(session, `(() => {
    const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[role=textbox][contenteditable=true]');
    if (!el) return { error: 'no composer' };
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = top;
    for (let i = 0; i < 4 && n; i++) { chain.push(n.tagName.toLowerCase() + '.' + String(n.className || '').slice(0, 50)); n = n.parentElement; }
    const desc = (x) => x ? x.tagName.toLowerCase() + '.' + String(x.className || '').slice(0, 50) : 'null';
    return {
      point: { cx, cy },
      composerIsTopmost: top === el || el.contains(top),
      topmost: desc(top),
      topmostChain: chain,
      composerRect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
      elFromPointIsComposerChild: top ? (el.contains(top) ? 'yes' : 'no') : 'none',
      dialogs: [...document.querySelectorAll('[role=dialog], [class*=modal], [class*=Modal], [class*=overlay], [class*=mask]')]
        .filter((d) => { const rr = d.getBoundingClientRect(); return rr.width > 100 && rr.height > 100; })
        .slice(0, 5)
        .map((d) => ({ cls: String(d.className || '').slice(0, 60), z: getComputedStyle(d).zIndex, text: norm(d.innerText).slice(0, 60) })),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} finally {
  session.close();
}
