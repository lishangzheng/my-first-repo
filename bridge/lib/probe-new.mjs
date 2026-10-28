// One-off reconnaissance for a NEW site: what is on this tab right now?
//
//   node lib/probe-new.mjs minimax
//   node lib/probe-new.mjs chatglm
//
// Prints the editor candidates, the buttons near the editor, and the shapes of
// repeated message containers -- enough to write a page contract in sites.mjs
// without guessing. Read-only: it never types or clicks.

import { connect, evaluate, listTargets } from './cdp.mjs';

const needle = process.argv[2];
if (!needle) {
  process.stderr.write('usage: probe-new.mjs <url-substring>\n');
  process.exit(2);
}

const tabs = await listTargets('127.0.0.1:9222');
const tab = tabs.find((t) => t.type === 'page' && t.url.toLowerCase().includes(needle.toLowerCase()));
if (!tab) {
  process.stderr.write('no tab matching "' + needle + '" on 9222\n');
  tabs.filter((t) => t.type === 'page').forEach((t) => process.stderr.write('  ' + t.url + '\n'));
  process.exit(2);
}

const session = await connect(tab);
try {
  const info = await evaluate(session, `(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) }; };
    const desc = (el) => ({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 60),
      id: el.id || '',
      ce: el.getAttribute('contenteditable') || '',
      role: el.getAttribute('role') || '',
      ph: el.getAttribute('placeholder') || '',
      aria: el.getAttribute('aria-label') || '',
      testid: el.getAttribute('data-testid') || '',
      rect: rect(el),
    });
    const editors = [...document.querySelectorAll('textarea, [contenteditable=""], [contenteditable=true], [role=textbox]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(desc);
    // buttons: anything clickable looking, plus their labels
    const buttons = [...document.querySelectorAll('button, [role=button], [aria-label]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top > 0; })
      .map((el) => ({ ...desc(el), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24), disabled: el.disabled || el.getAttribute('aria-disabled') || '' }))
      .slice(0, 40);
    // repeated containers: parents whose children share a class prefix
    const shapes = {};
    for (const el of document.querySelectorAll('div[class]')) {
      const n = el.querySelectorAll(':scope > *').length;
      if (n < 2) continue;
      const key = String(el.className).trim().split(/\\s+/).slice(0, 2).join('.');
      if (!key) continue;
      shapes[key] = (shapes[key] || 0) + 1;
    }
    const topShapes = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 12);
    return {
      url: location.href,
      title: document.title,
      bodyHead: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
      editors,
      buttons,
      topShapes,
      counts: {
        markdown: document.querySelectorAll('[class*=markdown]').length,
        message: document.querySelectorAll('[class*=message]').length,
        chatItem: document.querySelectorAll('[class*=chat-item]').length,
      },
    };
  })()`);

  console.log('URL   :', info.url);
  console.log('TITLE :', info.title);
  console.log('BODY  :', info.bodyHead);
  console.log('');
  console.log('EDITORS (' + info.editors.length + '):');
  for (const e of info.editors) console.log('  ' + JSON.stringify(e));
  console.log('');
  console.log('BUTTONS (' + info.buttons.length + '):');
  for (const b of info.buttons) {
    console.log('  ' + b.tag + ' cls=' + (b.cls || '-') + ' aria=' + JSON.stringify(b.aria) + ' testid=' + (b.testid || '-')
      + ' text=' + JSON.stringify(b.text) + ' disabled=' + JSON.stringify(String(b.disabled))
      + ' @' + b.rect.x + ',' + b.rect.y + ' ' + b.rect.w + 'x' + b.rect.h);
  }
  console.log('');
  console.log('COUNTS :', JSON.stringify(info.counts));
  console.log('SHAPES :', JSON.stringify(info.topShapes));
} finally {
  session.close();
}
