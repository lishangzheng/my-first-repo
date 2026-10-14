// Minimal Chrome DevTools Protocol client built on Node's global WebSocket.
// No third-party dependencies. Used by the local two-model bridge.
//
// Protocol: connect to a page target's webSocketDebuggerUrl, send
// {id, method, params} frames, resolve promises from the matching {id} reply.

const DEFAULT_HOST = '127.0.0.1:9222';

/** Fetch the list of debuggable targets from the browser endpoint. */
export async function listTargets(host = DEFAULT_HOST) {
  const res = await fetch(`http://${host}/json/list`);
  if (!res.ok) throw new Error(`CDP target listing failed: HTTP ${res.status}`);
  return res.json();
}

/** Pick the first real page target (type === "page"). */
export async function pickPage(host = DEFAULT_HOST) {
  const targets = await listTargets(host);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No page target found. Is the bridge browser running?');
  return page;
}

/** Open a short-lived CDP session against one target. */
export async function connect(target, { timeoutMs = 30000 } = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connect timeout')), timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`CDP socket error: ${e?.message ?? 'unknown'}`)); }, { once: true });
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}, { timeout = timeoutMs } = {}) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('CDP session closed'));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return {
    send,
    close() {
      closed = true;
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP session closed'));
      }
      pending.clear();
      try { ws.close(); } catch { /* already gone */ }
    },
  };
}

/** Navigate a page target and wait for the document to be ready. */
export async function navigate(session, url, { timeoutMs = 45000 } = {}) {
  await session.send('Page.enable');
  await session.send('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const { result } = await session.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (result?.value === 'complete') return;
    } catch { /* navigation in flight */ }
  }
  throw new Error(`Navigation did not settle: ${url}`);
}

/** Evaluate an expression in the page and return its value. */
export async function evaluate(session, expression, { awaitPromise = true, timeout = 30000 } = {}) {
  const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  }, { timeout });
  if (exceptionDetails) {
    throw new Error(`Page evaluation failed: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
  }
  return result?.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
