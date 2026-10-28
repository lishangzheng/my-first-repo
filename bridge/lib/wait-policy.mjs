// Pure decision step: "is the answer finished yet?"
//
// Extracted from ask.mjs so it can be tested WITHOUT a browser. Qianwen's review
// (2026-10-26) nailed why this matters: the quiet/stale/budget semantics are
// precisely the part that fails silently, and a table of synthetic timelines
// catches more than one lucky live run does.
//
// Contract:
//   * The caller supplies time from a MONOTONIC clock (performance.now()).
//     Date.now() jumps on sleep/wake; subtracting it across a suspend manufactures
//     a huge "quiet" period and trips staleBreakMs for no reason.
//   * The caller owns the budget: when now >= deadline it stops with 'budget'.
//     This function only answers "did the text settle, and may I stop?".
//
// Actions:
//   'wait'     -> not settled yet, keep polling
//   'progress' -> the text changed (new answer content, or a re-render of it)
//   'done'     -> stop; reason is 'quiet' (settled and not generating) or 'stale'
//                 (unchanged for staleBreakMs even though the page still claims
//                 to be generating -- protects against a stuck indicator)

export const DEFAULT_QUIET_MS = 2500;

export function initialWaitState() {
  return { best: '', stableSince: null };
}

export function nextWait(state, sample) {
  const cfg = sample || {};
  const now = cfg.now;
  const text = cfg.text;
  const generating = cfg.generating === undefined ? false : cfg.generating;
  const baseline = cfg.baseline === undefined ? '' : cfg.baseline;
  const quietMs = cfg.quietMs === undefined ? DEFAULT_QUIET_MS : cfg.quietMs;
  const staleBreakMs = cfg.staleBreakMs === undefined ? quietMs * 4 : cfg.staleBreakMs;

  // Nothing new: empty, or the previous turn's answer is still on screen.
  if (!text || text === baseline) {
    return { state: state, action: 'wait', reason: null };
  }

  if (text !== state.best) {
    // New content arrived, so the quiet timer restarts.
    return { state: { best: text, stableSince: null }, action: 'progress', reason: null };
  }

  const stableSince = state.stableSince === null ? now : state.stableSince;
  const quiet = now - stableSince;

  if (!generating && quiet >= quietMs) {
    return { state: { best: text, stableSince: stableSince }, action: 'done', reason: 'quiet' };
  }
  if (quiet >= staleBreakMs) {
    return { state: { best: text, stableSince: stableSince }, action: 'done', reason: 'stale' };
  }
  return { state: { best: text, stableSince: stableSince }, action: 'wait', reason: null };
}
