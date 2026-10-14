// Why did the prompt not land in the composer?
// Dumps the composer's attributes and its ancestor chain, plus the current page
// state, so a disabled/readonly/not-yet-hydrated editor can be told apart from
// a working one.
//   node lib/why-composer.mjs qwen

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
const COMPOSER = { qwen: '[role=textbox][contenteditable=true]', deepseek: 'textarea[placeholder]' };
if (!COMPOSER[key]) { process.stderr.write('usage: why-composer.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!tab) { console.error('no conversation tab'); process.exit(1); }

const session = await connect(tab);
try {
  const out = await evaluate(session, `(() => {
    const norm = (x) => (x || '').replace(/\\s+/g, ' ').trim();
    const composer = document.querySelector(${JSON.stringify(COMPOSER[key])});
    if (!composer) return { error: 'no composer element' };

    const attrs = {};
    for (const a of composer.attributes) attrs[a.name] = a.value;
    const r = composer.getBoundingClientRect();

    const ancestors = [];
    let n = composer;
    for (let i = 0; i < 5 && n; i++) {
      ancestors.push({
        tag: n.tagName.toLowerCase(),
        cls: String(n.className || '').slice(0, 60),
        inert: n.hasAttribute('inert'),
        ariaHidden: n.getAttribute('aria-hidden') || '',
        pointerEvents: getComputedStyle(n).pointerEvents,
        display: getComputedStyle(n).display,
        visibility: getComputedStyle(n).visibility,
      });
      n = n.parentElement;
    }

    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      visibility: document.visibilityState,
      bodyText: norm(document.body.innerText).slice(0, 200),
      composer: {
        attrs,
        contentEditable: composer.contentEditable,
        isContentEditable: composer.isContentEditable,
        innerText: norm(composer.innerText).slice(0, 60),
        textContent: norm(composer.textContent).slice(0, 60),
        rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
        pointerEvents: getComputedStyle(composer).pointerEvents,
      },
      ancestors,
      activeElement: document.activeElement ? (document.activeElement.tagName + '.' + String(document.activeElement.className || '').slice(0, 40)) : null,
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} finally {
  session.close();
}
