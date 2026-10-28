// probe-stream.mjs <url-needle> <enter|click> <send-sel> <answer-sel> [--seconds N]
// Types, submits, then samples the answer length and every plausible
// "still generating" marker, so the page contract can name a real one.
import { connect, evaluate, listTargets, sleep } from './cdp.mjs';
const argv = process.argv.slice(2);
const [needle, mode, sendSel, answerSel] = argv;
const si = argv.indexOf('--seconds');
const seconds = si >= 0 ? Number(argv[si + 1]) : 25;
const text = (() => { const ti = argv.indexOf('--text'); return ti >= 0 ? argv[ti + 1] : '用三句话介绍二分查找'; })();
const tabs = await listTargets('127.0.0.1:9222');
const tab = tabs.find((t) => t.type === 'page' && t.url.toLowerCase().includes(String(needle).toLowerCase()));
if (!tab) { console.error('no tab'); process.exit(2); }
const s = await connect(tab);
const box = await evaluate(s, `(() => {
  const el = document.querySelector('textarea, [data-testid=message-textarea], .ProseMirror, [contenteditable=true]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
if (!box) { console.log('no editor'); process.exit(1); }
const b = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 0, ...b });
await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...b });
await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...b });
await sleep(200);
await s.send('Input.insertText', { text });
await sleep(600);
if (mode === 'enter') {
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await s.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...k });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
} else {
  console.log('send:', await evaluate(s, `(() => { const el = document.querySelector(${JSON.stringify(sendSel)}); if (!el) return 'NOT FOUND'; el.click(); return 'clicked'; })()`));
}
const start = Date.now();
let prev = '';
while (Date.now() - start < seconds * 1000) {
  await sleep(700);
  const snap = await evaluate(s, `(() => ({
    ans: (() => { const n = document.querySelectorAll(${JSON.stringify(answerSel)}); return n.length ? (n[n.length - 1].innerText || '').trim().length : -1; })(),
    markers: ['[class*=streaming]','[class*=generating]','[class*=loading]','[class*=stop]','[class*=pause]','[class*=typing]','[class*=thinking]','[aria-label*=停止]','[aria-label*=中断]','[data-testid*=stop]']
      .map(sel => [sel, document.querySelectorAll(sel).length])
      .filter(p => p[1] > 0),
  }))()`);
  const line = Math.round((Date.now() - start) / 500) / 2 + 's ans=' + snap.ans + ' markers=' + JSON.stringify(snap.markers);
  if (line !== prev) { console.log(line); prev = line; }
}
s.close();