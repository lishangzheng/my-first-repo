// Type into a new site's editor and report what becomes clickable.
//   node lib/probe-type.mjs chatglm "测试"
// Read-only except for filling the composer (no send). Leaves the text in place
// so the next step can inspect it, or clear it with clear-composer.mjs.

import { connect, evaluate, listTargets, sleep } from './cdp.mjs';

const needle = process.argv[2];
const text = process.argv[3] || '你好';
const tabs = await listTargets('127.0.0.1:9222');
const tab = tabs.find((t) => t.type === 'page' && t.url.toLowerCase().includes(String(needle).toLowerCase()));
if (!tab) { process.stderr.write('no tab\n'); process.exit(2); }
const s = await connect(tab);
try {
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
  await sleep(700);

  const out = await evaluate(s, `(() => {
    const ed = document.querySelector('textarea, [data-testid=message-textarea], .ProseMirror, [contenteditable=true]');
    const v = ed ? String(ed.value !== undefined ? ed.value : ed.innerText || '') : '';
    const er = ed ? ed.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0 };
    const near = [...document.querySelectorAll('button, [role=button], [aria-label], [data-testid], div[class*=send], div[class*=send]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // within a generous band around the editor
        return r.top >= er.top - 120 && r.top <= er.bottom + 90 && r.right >= er.left - 40 && r.left <= er.right + 220;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 50),
          testid: el.getAttribute('data-testid') || '',
          aria: el.getAttribute('aria-label') || '',
          text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 20),
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') || '',
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        };
      });
    return { value: v.slice(0, 60), valueLen: v.length, near };
  })()`);
  console.log('EDITOR VALUE:', JSON.stringify(out.value), 'len=' + out.valueLen);
  console.log('NEARBY CONTROLS (' + out.near.length + '):');
  for (const c of out.near) console.log('  ' + c.tag + ' cls=' + (c.cls || '-') + ' testid=' + (c.testid || '-') + ' aria=' + JSON.stringify(c.aria) + ' text=' + JSON.stringify(c.text) + ' disabled=' + JSON.stringify(String(c.disabled)) + ' @' + c.x + ',' + c.y + ' ' + c.w + 'x' + c.h);
} finally { s.close(); }
