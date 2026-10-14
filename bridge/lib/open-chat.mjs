// Open a site's chat page in the target the bridge drives.
//   node lib/open-chat.mjs qwen
//   node lib/open-chat.mjs deepseek
//
// Needed because the Qianwen client does not restore its previous conversation
// after a restart (it lands on chrome://newtab/), and the driver only attaches
// to a tab whose URL matches the site's conversation pattern.

import { connect, evaluate, listTargets, navigate, sleep } from './cdp.mjs';
import { site } from './sites.mjs';

const key = process.argv[2];
if (!key) { process.stderr.write('usage: open-chat.mjs <deepseek|qwen>\n'); process.exit(2); }

const s = site(key);
const tabs = await listTargets(`127.0.0.1:${s.port}`);

console.log(`port ${s.port}: ${tabs.length} targets`);
for (const t of tabs) console.log(`   ${t.type.padEnd(15)} | ${t.title} | ${t.url.slice(0, 90)}`);

let tab = tabs.find(s.match);
if (tab) {
  console.log('already on a conversation tab:', tab.url);
} else {
  // Prefer an empty tab, then any page that can host the site.
  tab = tabs.find((t) => t.type === 'page' && /^chrome:\/\/newtab|^about:blank/.test(t.url))
     || tabs.find((t) => t.type === 'page' && !/^chrome:|^uccd:|^devtools:/.test(t.url));
  if (!tab) { console.error('no usable page target to navigate'); process.exit(1); }
  console.log('navigating', tab.url, '->', s.newChatUrl);
  const session = await connect(tab);
  try {
    await navigate(session, s.newChatUrl);
    await sleep(3000);
  } finally {
    session.close();
  }
}

// Report the resulting state.
const after = (await listTargets(`127.0.0.1:${s.port}`)).find(s.match);
if (!after) { console.error('FAILED: still no matching conversation tab'); process.exit(1); }
const session = await connect(after);
try {
  console.log('url  :', await evaluate(session, 'location.href'));
  console.log('title:', await evaluate(session, 'document.title'));
  console.log('visibility:', await evaluate(session, 'document.visibilityState'));
  const composer = await evaluate(session, `(() => {
    const el = document.querySelector(${JSON.stringify(key === 'qwen'
      ? '[role=textbox][contenteditable=true]'
      : 'textarea[placeholder]')});
    return el ? el.tagName.toLowerCase() : 'NOT FOUND';
  })()`);
  console.log('composer:', composer);
} finally {
  session.close();
}
