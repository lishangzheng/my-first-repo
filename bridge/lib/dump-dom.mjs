// Live DOM probe for one configured site.
//   node lib/dump-dom.mjs deepseek
//   node lib/dump-dom.mjs qwen
//
// Prints candidate composers, send buttons and answer containers so the
// driver's selectors come from real evidence instead of guesses.

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const PROBE = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
    id: el.id || '',
    role: el.getAttribute('role') || '',
    placeholder: el.getAttribute('placeholder') || '',
    aria: el.getAttribute('aria-label') || '',
    ce: el.getAttribute('contenteditable') || '',
    text: (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
    w: Math.round(rect(el).width),
    h: Math.round(rect(el).height),
  });
  const q = (sel) => [...document.querySelectorAll(sel)].map(desc);
  return {
    url: location.href,
    title: document.title,
    composers: q('textarea, [contenteditable=true], [role=textbox]'),
    buttons: q('button, [role=button]').filter((b) => b.w > 0 && b.h > 0).slice(0, 24),
    markdownish: [...document.querySelectorAll('div[class*=markdown], div[class*=answer], div[class*=message]')]
      .slice(-6).map(desc),
  };
})()`;

const key = process.argv[2];
if (!key) {
  process.stderr.write('usage: dump-dom.mjs <deepseek|qwen>\n');
  process.exit(2);
}

const s = site(key);
const targets = await listTargets(`127.0.0.1:${s.port}`);
const target = targets.find(s.match);
if (!target) {
  process.stderr.write(`no matching tab on port ${s.port}. tabs:\n${targets.map((t) => `  ${t.type} ${t.url}`).join('\n')}\n`);
  process.exit(1);
}

const session = await connect(target);
try {
  process.stdout.write(`${JSON.stringify(await evaluate(session, PROBE), null, 2)}\n`);
} finally {
  session.close();
}
