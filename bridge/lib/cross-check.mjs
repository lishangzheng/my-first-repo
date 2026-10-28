// Multi-model cross-check: ask the same question to every logged-in model the
// bridge can drive, in parallel, and emit all raw answers for the orchestrator.
//
//   node cross-check.mjs "问题"
//   node cross-check.mjs "问题" --sites qwen,deepseek --timeout 240
//   node cross-check.mjs "问题" --out ..\cross-check\2026-10-25-2310.md
//
// Wait budget: every site declares its own (sites.mjs). Kimi legitimately thinks
// for minutes, so this used to fail one model with a shared 240s deadline and
// then get re-run -- duplicating the question in the user's history. Now each
// side waits as long as that model actually deserves, and progress is printed to
// stderr every 15s so a slow side never looks like a hang.
//
// --timeout <sec> still forces ONE number on every side (useful for a quick
// bounded run); omit it to use the per-site budgets. --quiet silences the
// progress lines (stdout stays pure JSON either way).

import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SITES, SITES } from './sites.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ASK = join(here, 'ask.mjs');
const DEFAULT_TIMEOUT_SEC = 180;

function parseArgs(argv) {
  const positional = [];
  const flags = { timeout: null, out: null, sites: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') flags.timeout = Number(argv[++i]);
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '--sites') flags.sites = argv[++i];
    else if (a === '--quiet') flags.quiet = true;
    else positional.push(a);
  }
  return { positional, flags };
}

const ARGS = (siteKey, prompt, timeoutSec) => [ASK, siteKey, prompt, '--timeout', String(timeoutSec)];

/**
 * Run one site in a child process and return its parsed JSON.
 *
 * Pipes are the happy path (they stream the child's heartbeats live). Some
 * sandboxed environments refuse to create the pipes Node uses for stdio and
 * throw EPERM on spawn -- there, the same child runs with its output redirected
 * to temp FILES instead, which needs no named pipe. The cost is that heartbeats
 * arrive only after the child exits; correctness is identical.
 */
function runAsk(siteKey, prompt, timeoutSec) {
  const finish = (resolvePromise, code, out, err) => {
    try {
      const parsed = JSON.parse(out);
      resolvePromise({ ...parsed, ok: code === 0 && !parsed.error });
    } catch {
      resolvePromise({
        site: siteKey, ok: false, answer: '', answerChars: 0,
        error: `BRIDGE_EXIT_${code}: ${err.trim() || out.trim() || 'no output'}`,
      });
    }
  };

  const spawnPiped = (resolvePromise) => {
    const child = spawn(process.execPath, ARGS(siteKey, prompt, timeoutSec), {
      cwd: here,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    // The child reports its own "still waiting" beats on stderr; forward them so
    // one slow model is visible while the others are already done.
    child.stderr.on('data', (d) => {
      err += d.toString();
      process.stderr.write(d.toString());
    });
    child.on('close', (code) => finish(resolvePromise, code, out, err));
  };

  const spawnFiles = (resolvePromise) => {
    const base = join(tmpdir(), `cc-${process.pid}-${siteKey}-${Date.now()}`);
    const outPath = base + '.out.json';
    const errPath = base + '.err.txt';
    const outFd = openSync(outPath, 'w');
    const errFd = openSync(errPath, 'w');
    let child;
    try {
      child = spawn(process.execPath, ARGS(siteKey, prompt, timeoutSec), {
        cwd: here,
        windowsHide: true,
        stdio: ['ignore', outFd, errFd],
      });
    } catch (e) {
      closeSync(outFd); closeSync(errFd);
      resolvePromise({ site: siteKey, ok: false, answer: '', answerChars: 0, error: 'SPAWN_FAILED: ' + e.message });
      return;
    }
    child.on('close', (code) => {
      closeSync(outFd); closeSync(errFd);
      const out = readFileSync(outPath, 'utf8');
      const err = readFileSync(errPath, 'utf8');
      try { unlinkSync(outPath); unlinkSync(errPath); } catch { /* best effort */ }
      if (err.trim()) process.stderr.write(err);
      finish(resolvePromise, code, out, err);
    });
  };

  return new Promise((resolvePromise) => {
    try {
      spawnPiped(resolvePromise);
    } catch (e) {
      if (e && e.code === 'EPERM') spawnFiles(resolvePromise);
      else resolvePromise({ site: siteKey, ok: false, answer: '', answerChars: 0, error: 'SPAWN_FAILED: ' + e.message });
    }
  });
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const prompt = positional.join(' ').trim();
if (!prompt) {
  process.stderr.write('usage: cross-check.mjs "<question>" [--sites a,b,c] [--timeout <sec>] [--out file.md] [--quiet]\n');
  process.stderr.write('       --timeout forces one budget for every side; omit it to use each site\'s own (kimi waits longest)\n');
  process.exit(2);
}

// Which models to ask. Unknown names are refused up front instead of silently
// producing a one-sided "cross-check".
const requested = flags.sites
  ? flags.sites.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SITES.slice();
const unknown = requested.filter((k) => !SITES[k]);
if (unknown.length) {
  process.stderr.write(`unknown site(s): ${unknown.join(', ')} (known: ${Object.keys(SITES).join(', ')})\n`);
  process.exit(2);
}

const budgetFor = (k) => flags.timeout ?? SITES[k].timeoutSec ?? DEFAULT_TIMEOUT_SEC;
const timeouts = {};
for (const k of requested) timeouts[k] = budgetFor(k);

const started = Date.now();
const pending = new Set(requested);
const finished = [];

const beat = () => {
  if (flags.quiet) return;
  const elapsed = Math.round((Date.now() - started) / 1000);
  const done = finished
    .map((r) => r.site + '=' + (r.ok ? 'ok' : String(r.error).split(':')[0]))
    .join(' ');
  const waiting = [...pending].map((k) => k + '(' + timeouts[k] + 's)').join(', ');
  process.stderr.write(`[cross-check] ${elapsed}s | done: ${done || '-'} | waiting: ${waiting || '-'}\n`);
};
const timer = setInterval(beat, 15000);
if (typeof timer.unref === 'function') timer.unref();

const results = await Promise.all(requested.map(async (k) => {
  const r = await runAsk(k, prompt, timeouts[k]);
  pending.delete(k);
  finished.push(r);
  if (!flags.quiet) {
    process.stderr.write(`[cross-check] ${k} ${r.ok ? 'ok' : r.error} in ${Math.round((r.elapsedMs || 0) / 1000)}s\n`);
  }
  return r;
}));
clearInterval(timer);

// Actionable hints, so a partial result never turns into "just run it again".
for (const r of results) {
  const err = String(r.error || '');
  if (!r.ok && /WEB_NO_PROGRESS|WEB_EMPTY_REPLY/.test(err)) {
    r.hint = 'the answer may already be on the page: run "node bridge\\lib\\read-last.mjs '
      + r.site + '" to read it instead of re-sending (re-sending duplicates the question in the user history)';
  }
  if (r.ok && (r.truncated || r.staleCut)) {
    r.hint = 'this answer may be incomplete (ended by ' + r.endReason + '): re-read it later with "node bridge\\\\lib\\\\read-last.mjs '
      + r.site + '" rather than re-asking';
  }
  if (!r.ok && /LIMIT_QUEUE/.test(err)) {
    r.hint = 'kimi is rate-limited or queueing: wait a while, or switch the model to its fast mode. The bridge itself is fine.';
  }
}

const sides = {};
requested.forEach((k, i) => { sides[k] = results[i]; });

// With five models, a failure is expected and must not poison the run: the
// user's rule is "use whoever answered, ignore the rest". So `ok` means "this
// run is usable" (at least one answer), while `allOk` says whether every side
// answered. Exit code follows `ok`.
const answered = results.filter((r) => r.ok).map((r) => r.site);
const failed = results.filter((r) => !r.ok).map((r) => ({ site: r.site, error: r.error }));

const payload = {
  question: prompt,
  requestedSites: requested,
  timeouts,
  totalElapsedMs: Date.now() - started,
  sides,
  answered,
  failed,
  answeredCount: answered.length,
  ok: answered.length > 0,
  allOk: failed.length === 0,
};

if (flags.out) {
  const lines = [
    `# 多模型交叉校对原始记录`,
    ``,
    `- 问题：${prompt}`,
    `- 时间：${new Date().toISOString()}`,
    `- 参与站点：${requested.join(', ')}`,
    `- 等待预算：${requested.map((k) => k + ' ' + timeouts[k] + 's').join(' / ')}`,
    `- 总耗时：${payload.totalElapsedMs} ms`,
    ``,
  ];
  for (const k of requested) {
    const r = sides[k];
    const label = SITES[k].label;
    const mark = r.ok ? (r.truncated ? 'ok，但可能被预算截断' : (r.staleCut ? 'ok，但可能停在半句（stale 收尾）' : 'ok')) : `未参与：${r.error}`;
    lines.push(`## 【${label}】(${mark})`, '', r.answer || '(无回答)', '');
  }
  lines.push('---', '', `参与并作答：${answered.join(', ') || '无'}`,
    `未参与：${failed.length ? failed.map((f) => f.site + '（' + f.error + '）').join('、') : '无'}`, '');
  const outPath = resolve(flags.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf8');
  payload.recordPath = outPath;
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exitCode = payload.ok ? 0 : 1;
