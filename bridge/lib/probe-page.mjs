// Page-side probe: describe every candidate input / button on the current page.
// Runs inside the page via CDP Runtime.evaluate; prints JSON to stdout.

import { connect, evaluate, pickPage } from './cdp.mjs';

const PROBE = `(() => {
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
    id: el.id || '',
    role: el.getAttribute('role') || '',
    type: el.getAttribute('type') || '',
    placeholder: el.getAttribute('placeholder') || '',
    aria: el.getAttribute('aria-label') || '',
    ce: el.getAttribute('contenteditable') || '',
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
    visible: !!(el.getBoundingClientRect().width && el.getBoundingClientRect().height),
  });
  const inputs = [...document.querySelectorAll('textarea, input[type=text], [contenteditable=true], [role=textbox]')].map(desc);
  const buttons = [...document.querySelectorAll('button, [role=button], div[class*=send], div[class*=Send]')]
    .map(desc).filter((d) => d.visible).slice(0, 40);
  return {
    url: location.href,
    title: document.title,
    loginHint: /log ?in|sign ?in|登录/i.test(document.body.innerText.slice(0, 4000)),
    bodyHead: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
    inputs,
    buttons,
  };
})()`;

const session = await connect(await pickPage());
try {
  process.stdout.write(`${JSON.stringify(await evaluate(session, PROBE), null, 2)}\n`);
} finally {
  session.close();
}
