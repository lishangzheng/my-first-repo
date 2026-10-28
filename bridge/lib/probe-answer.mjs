// probe-answer.mjs <url-needle> <send-selector> [--seconds N]
// Clicks send with el.click(), then reports what grows: candidate answer
// containers (elements holding >60 chars), so a page contract can be written
// from evidence instead of class-name guesses.
import { connect, evaluate, listTargets, sleep } from './cdp.mjs';
const [needle, sendSel] = process.argv.slice(2);
const si = process.argv.indexOf('--seconds');
const seconds = si >= 0 ? Number(process.argv[si + 1]) : 30;
const tabs = await listTargets('127.0.0.1:9222');
const tab = tabs.find((t) => t.type === 'page' && t.url.toLowerCase().includes(String(needle).toLowerCase()));
if (!tab) { console.error('no tab'); process.exit(2); }
const s = await connect(tab);
const clicked = await evaluate(s, `(() => { const b = document.querySelector(${JSON.stringify(sendSel)}); if (!b) return 'NOT FOUND'; b.click(); return 'clicked'; })()`);
console.log('send:', clicked);
const start = Date.now();
let prev = '';
while (Date.now() - start < seconds * 1000) {
  await sleep(2000);
  const snap = await evaluate(s, `(() => ({
    body: document.body.innerText.length,
    url: location.href.slice(0, 70),
    cands: ['[class*=markdown]','[class*=message]','[class*=chat-item]','[class*=bubble]','[class*=answer]','[class*=content-box]', '.segment', '[data-testid*=message]'].map(sel => [sel, document.querySelectorAll(sel).length, (() => { const n = document.querySelectorAll(sel); return n.length ? (n[n.length-1].innerText||'').trim().length : -1; })()]),
  }))()`);
  const line = Math.round((Date.now() - start) / 1000) + 's body=' + snap.body + ' url=' + snap.url + ' cands=' + JSON.stringify(snap.cands.filter(c => c[1] > 0));
  if (line !== prev) { console.log(line); prev = line; }
}
const carriers = await evaluate(s, `(() => {
  const out = [];
  for (const el of document.querySelectorAll('div,article,section,li')) {
    const t = (el.innerText || '').trim();
    if (t.length < 60) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out.push({ cls: String(el.className || '').slice(0, 70), len: t.length, w: Math.round(r.width), h: Math.round(r.height), head: t.slice(0, 40).replace(/\\s+/g, ' ') });
  }
  out.sort((a, b) => a.len - b.len);
  return out.slice(0, 12);
})()`);
console.log('SMALLEST TEXT CARRIERS (>60 chars):');
for (const c of carriers) console.log('  len=' + c.len + ' ' + c.w + 'x' + c.h + ' .' + c.cls + ' :: ' + c.head);
s.close();