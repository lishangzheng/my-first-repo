// Tell "virtualised / not yet rendered" apart from "genuinely empty".
//
// Scrolls every scrollable container to the bottom, waits, then counts how many
// answer cards actually carry text -- and searches the whole document for a
// substring, so an answer rendered somewhere unexpected can still be found.
//
//   node lib/why-scroll.mjs qwen [--find "22"]

import { connect, evaluate, listTargets, sleep } from './cdp.mjs';
import { site } from './sites.mjs';

const argv = process.argv.slice(2);
const key = argv[0];
const fi = argv.indexOf('--find');
const needle = fi >= 0 ? argv[fi + 1] : '';
if (!key) { process.stderr.write('usage: why-scroll.mjs <deepseek|qwen> [--find text]\n'); process.exit(2); }

const CARD = { qwen: 'div.answer-common-card', deepseek: 'div.ds-markdown' }[key];
const s = site(key);
const tab = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
const session = await connect(tab);

const survey = `(() => {
  const norm = (x) => x.replace(/\\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll(${JSON.stringify(CARD)})];
  const withText = cards.filter((c) => norm(c.innerText || '').length > 0);
  const scrollers = [...document.querySelectorAll('*')].filter((el) => {
    if (el.scrollHeight - el.clientHeight < 200) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll';
  }).map((el) => ({ cls: String(el.className || '').slice(0, 50), top: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight) }));
  return {
    cards: cards.length,
    withText: withText.length,
    lastWithText: withText.length ? norm(withText[withText.length - 1].innerText).slice(0, 120) : '',
    scrollers,
  };
})()`;

try {
  console.log('--- before scroll ---');
  console.log(JSON.stringify(await evaluate(session, survey), null, 2));

  await evaluate(session, `(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight - el.clientHeight > 200) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') el.scrollTop = el.scrollHeight;
      }
    }
    window.scrollTo(0, document.body.scrollHeight);
    return true;
  })()`);
  await sleep(2500);

  console.log('--- after scroll ---');
  console.log(JSON.stringify(await evaluate(session, survey), null, 2));

  if (needle) {
    const found = await evaluate(session, `(() => {
      const norm = (x) => x.replace(/\\s+/g, ' ').trim();
      const N = ${JSON.stringify(needle)};
      const hits = [];
      for (const el of document.querySelectorAll('*')) {
        let own = '';
        for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
        if (norm(own).includes(N)) hits.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 50), own: norm(own).slice(0, 90) });
        if (hits.length > 12) break;
      }
      return { inBodyText: norm(document.body.innerText).includes(N), hits };
    })()`);
    console.log(`--- search for ${JSON.stringify(needle)} ---`);
    console.log(JSON.stringify(found, null, 2));
  }
} finally {
  session.close();
}
