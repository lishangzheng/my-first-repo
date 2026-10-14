// Tiny operator CLI for the local bridge browser.
//   node cdp-cli.mjs targets
//   node cdp-cli.mjs navigate <url>
//   node cdp-cli.mjs eval "<js expression>"
//   node cdp-cli.mjs text
//
// Exists so a human can inspect exactly what the agent sees, and reproduce
// any step by hand. Every command prints JSON to stdout.

import { connect, evaluate, listTargets, navigate, pickPage } from './cdp.mjs';

const [, , command, ...rest] = process.argv;

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  switch (command) {
    case 'targets': {
      const targets = await listTargets();
      print(targets.map((t) => ({ type: t.type, title: t.title, url: t.url })));
      return;
    }
    case 'navigate': {
      const url = rest[0];
      if (!url) throw new Error('usage: navigate <url>');
      const session = await connect(await pickPage());
      try {
        await navigate(session, url);
        print({ ok: true, url, title: await evaluate(session, 'document.title') });
      } finally { session.close(); }
      return;
    }
    case 'eval': {
      const expression = rest.join(' ');
      if (!expression) throw new Error('usage: eval "<js>"');
      const session = await connect(await pickPage());
      try { print(await evaluate(session, expression)); } finally { session.close(); }
      return;
    }
    case 'text': {
      const session = await connect(await pickPage());
      try {
        print(await evaluate(session, 'document.body.innerText'));
      } finally { session.close(); }
      return;
    }
    default:
      throw new Error('usage: cdp-cli.mjs <targets|navigate|eval|text> [...]');
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
});
