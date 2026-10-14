// Dual-model cross-check: ask the same question to the logged-in Qwen client
// and the logged-in DeepSeek web session at the same time, and emit both raw
// answers for the orchestrator to compare.
//
//   node cross-check.mjs "问题"
//   node cross-check.mjs "问题" --timeout 240 --out ..\cross-check\2026-10-12-1400.md
//
// Both sub-processes run concurrently; a failure on one side never hides the
// other side's answer, and every failure carries a coded reason.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ASK = join(here, 'ask.mjs');

function parseArgs(argv) {
  const positional = [];
  const flags = { timeout: 240, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') flags.timeout = Number(argv[++i]);
    else if (a === '--out') flags.out = argv[++i];
    else positional.push(a);
  }
  return { positional, flags };
}

function runAsk(siteKey, prompt, timeoutSec) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [ASK, siteKey, prompt, '--timeout', String(timeoutSec)], {
      cwd: here,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(out);
        resolvePromise({ ...parsed, ok: code === 0 && !parsed.error });
      } catch {
        resolvePromise({
          site: siteKey, ok: false, answer: '', answerChars: 0,
          error: `BRIDGE_EXIT_${code}: ${err.trim() || out.trim() || 'no output'}`,
        });
      }
    });
  });
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const prompt = positional.join(' ').trim();
if (!prompt) {
  process.stderr.write('usage: cross-check.mjs "<question>" [--timeout 240] [--out file.md]\n');
  process.exit(2);
}

const started = Date.now();
const [qwen, deepseek] = await Promise.all([
  runAsk('qwen', prompt, flags.timeout),
  runAsk('deepseek', prompt, flags.timeout),
]);

const payload = {
  question: prompt,
  totalElapsedMs: Date.now() - started,
  sides: { qwen, deepseek },
  ok: Boolean(qwen.ok && deepseek.ok),
};

if (flags.out) {
  const lines = [
    `# 双模型交叉校对原始记录`,
    ``,
    `- 问题：${prompt}`,
    `- 时间：${new Date().toISOString()}`,
    `- 总耗时：${payload.totalElapsedMs} ms`,
    ``,
    `## 【千问观点】(${qwen.ok ? 'ok' : `失败 ${qwen.error}`})`,
    ``,
    qwen.answer || '(无回答)',
    ``,
    `## 【DeepSeek 观点】(${deepseek.ok ? 'ok' : `失败 ${deepseek.error}`})`,
    ``,
    deepseek.answer || '(无回答)',
    ``,
  ];
  const outPath = resolve(flags.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf8');
  payload.recordPath = outPath;
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exitCode = payload.ok ? 0 : 1;
