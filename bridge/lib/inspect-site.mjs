// Diagnostic view of what the driver actually sees on one site.
//   node lib/inspect-site.mjs qwen
//   node lib/inspect-site.mjs deepseek
//
// Prints the conversation tab, the composer state, the answer blocks the
// driver would read (with lengths), and the tail of the visible text. Use this
// first whenever a run reports WEB_EMPTY_REPLY, WEB_NO_PROGRESS or NEED_LOGIN.

import { connect, evaluate, listTargets } from './cdp.mjs';
import { page as pageContract, SITES, site } from './sites.mjs';

const key = process.argv[2];
if (!key || !SITES[key]) {
  process.stderr.write('usage: inspect-site.mjs <' + Object.keys(SITES).join('|') + '>\n');
  process.exit(2);
}

const s = site(key);
const page = pageContract(key);

let tabs;
try {
  tabs = await listTargets(`127.0.0.1:${s.port}`);
} catch (err) {
  console.log(`port ${s.port}: NOT REACHABLE (${err.message})`);
  console.log('-> the bridge program for this site is not running');
  process.exit(1);
}

console.log(`port ${s.port}: reachable, ${tabs.length} targets`);
for (const t of tabs) console.log(`   ${t.type.padEnd(15)} | ${t.title} | ${t.url}`);

const tab = tabs.find(s.match);
if (!tab) {
  console.log('NO MATCHING CONVERSATION TAB for this site.');
  console.log(`matcher expected type=page and url~${s.match.toString()}`);
  process.exit(1);
}

const session = await connect(tab);
try {
  console.log('');
  console.log('url            :', await evaluate(session, 'location.href'));
  console.log('title          :', await evaluate(session, 'document.title'));

  const composer = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(page.composer)});
    if (!el) return null;
    return { tag: el.tagName.toLowerCase(), text: String(el.value ?? el.innerText ?? '').slice(0, 120) };
  })()`);
  console.log('composer       :', composer ? `${composer.tag} text=${JSON.stringify(composer.text)}` : 'NOT FOUND');

  const blocks = await evaluate(session, `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(page.answers)})];
    return {
      count: nodes.length,
      lens: nodes.slice(-6).map((n) => (n.innerText || '').trim().length),
      lastText: nodes.length ? (nodes[nodes.length - 1].innerText || '').trim().slice(0, 400) : '',
    };
  })()`);
  console.log('answer blocks  : count=' + blocks.count + '  last-6 lengths=' + JSON.stringify(blocks.lens));
  console.log('last block text:', JSON.stringify(blocks.lastText));

  const loggedOut = await evaluate(session, page.loggedOut || `(() => {
    const t = document.body.innerText;
    return /发送验证码|扫码登录|密码登录/.test(t) && !document.querySelector(${JSON.stringify(page.composer)});
  })()`);
  console.log('logged out?    :', loggedOut);

  const tail = await evaluate(session, 'document.body.innerText.replace(/\\s+/g, " ").trim().slice(-260)');
  console.log('visible tail   :', JSON.stringify(tail));
} finally {
  session.close();
}
