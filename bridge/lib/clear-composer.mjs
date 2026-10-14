// Clear a site's composer. Useful after an aborted run left text behind, which
// otherwise makes the next send look like it failed (the old text is still there).
//   node lib/clear-composer.mjs qwen

import { connect, evaluate, listTargets } from './cdp.mjs';
import { site } from './sites.mjs';

const PAGE = {
  deepseek: 'textarea[placeholder]',
  qwen: '[role=textbox][contenteditable=true]',
};

const key = process.argv[2];
if (!PAGE[key]) { process.stderr.write('usage: clear-composer.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!tab) { console.error(`no conversation tab on port ${s.port}`); process.exit(1); }

const session = await connect(tab);
try {
  const cleared = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(PAGE[key])});
    if (!el) return 'NO_COMPOSER';
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { el.value = ''; }
    else { el.innerHTML = ''; }
    return String((el.value !== undefined && el.value !== null) ? el.value : el.innerText || '').trim();
  })()`);
  console.log('composer now:', JSON.stringify(cleared));
} finally {
  session.close();
}
