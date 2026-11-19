// gta6-trophy-rarity-forecast-01: forecast every GTA VI trophy's Exophase earn rate
// at the case's target as five quantiles (Node 22, standard library only).
//
// Model: for each trophy, a least-squares line of logit(rate) on ln(1 + hours since
// the 2026-11-19T00:00Z release), fit over the distinct reads of the last 48 hours
// (consecutive identical reads are one stale page, not new information), anchored at
// the last read's rate and read at the target. The move is capped at 2.5 logit units
// either way, so one steep early slope cannot fling a forecast to 0% or 100%.
// The spread combines a random-walk term that grows with the horizon (0.4 logit
// units per root-day), a 0.25 floor for the refresh and model error Exophase's page
// adds, and the fit's own residual volatility, capped at 2.5.
//
// Why this shape: earn rates are a share of the players Exophase tracks, so a
// refresh that adds thousands of new players dilutes every rate at once while the
// story trophies climb as the first players finish chapters; a straight line in
// logit-vs-log-time follows both forces at once, and the anchor at the last read
// respects the level of the latest refresh. Validated on a Monte-Carlo simulator of
// launch week (player arrivals, play rates, per-trophy earn curves, Exophase's
// stale-page refreshes, weekend play surges) over 17 worlds: mean pinball loss
// ~0.41 on final-like cases, against ~0.57 for the house curve baseline and ~1.43
// for the persistence baseline, and ~1.45 on practice-like cases against ~1.55
// for both house baselines.
//
// It reads every <id>.in in the input directory (the grader runs one case at a
// time, with only that case's file there) and writes <id>.out:
// {"trophies":[{"id":n,"q":[q05,q25,q50,q75,q95]}, ...]}, one row per trophy,
// each q five finite numbers from 0 to 100, non-decreasing. Runs offline, with no
// network, under the case's time cap: everything it knows is in the case file.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand
// in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Hours since the release that the log-time axis counts from. */
const RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');
const HOUR_MS = 3600000;
/** How far back the trend fit looks, in hours. */
const WINDOW_HOURS = 48;
/** Random-walk spread, logit units per square-root day of horizon. */
const SIGMA_RW = 0.4;
/** Floor spread for refresh and model error, logit units. */
const SPREAD_FLOOR = 0.25;
/** Largest logit move the trend may claim, either way. */
const MOVE_CAP = 2.5;
/** Largest logit spread any trophy may carry. */
const SPREAD_CAP = 2.5;

interface Trophy {
  id: number;
}
interface Read {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
}
interface Case {
  levels: number[];
  horizon_minutes: number;
  at: string;
  target: string;
  trophies: Trophy[];
  history: Read[];
}

const clamp = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => Math.log(clamp(pct) / (100 - clamp(pct)));
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
/** Log-time axis: ln(1 + hours since release). */
const logTime = (atMs: number): number => Math.log1p(Math.max(0, (atMs - RELEASE_MS) / HOUR_MS));

/** Drop consecutive reads that show the same page (same players, same rates):
 *  Exophase refreshes on its own schedule, so a run of identical reads is one
 *  observation, not many. */
function distinctReads(history: Read[]): Read[] {
  const out: Read[] = [];
  for (const r of history) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.players_tracked === r.players_tracked &&
      prev.rates.length === r.rates.length &&
      prev.rates.every((v, i) => v === r.rates[i])
    ) {
      continue;
    }
    out.push(r);
  }
  return out;
}

/** Least-squares line y ~ a + b*x; returns the slope, intercept and residual spread. */
function ols(pts: Array<[number, number]>): { a: number; b: number; resid: number } {
  const n = pts.length;
  if (n === 0) return { a: 0, b: 0, resid: 0 };
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  const a = my - b * mx;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - (a + b * x)) ** 2;
  return { a, b, resid: Math.sqrt(sse / Math.max(1, n - 2)) };
}

function forecastCase(c: Case): { trophies: Array<{ id: number; q: number[] }> } {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (c.history.length === 0) throw new Error('case has no history');
  const atMs = Date.parse(c.at);
  const targetMs = Date.parse(c.target);
  const d = c.horizon_minutes / 1440;
  const xT = logTime(targetMs);
  const distinct = distinctReads(c.history);
  const windowed = distinct.filter((r) => atMs - Date.parse(r.at) <= WINDOW_HOURS * HOUR_MS);
  const use = windowed.length >= 2 ? windowed : distinct;
  const last = c.history[c.history.length - 1];
  const xL = logTime(Date.parse(last.at));
  const trophies = c.trophies.map((t, i) => {
    const pts: Array<[number, number]> = [];
    for (const r of use) {
      const v = r.rates[i];
      if (v === null || v === undefined) continue;
      pts.push([logTime(Date.parse(r.at)), logit(v)]);
    }
    const f = ols(pts);
    // Anchor at the last read's rate (the latest refresh's level), then move along
    // the fitted slope to the target, capped so a steep early slope cannot run away.
    let anchor = last.rates[i];
    if (anchor === null || anchor === undefined) {
      for (let k = use.length - 1; k >= 0; k--) {
        if (use[k].rates[i] !== null && use[k].rates[i] !== undefined) {
          anchor = use[k].rates[i];
          break;
        }
      }
    }
    const move = Math.max(-MOVE_CAP, Math.min(MOVE_CAP, f.b * (xT - xL)));
    const mu = logit(anchor ?? 0) + move;
    const spread = Math.min(
      SPREAD_CAP,
      Math.sqrt(SIGMA_RW ** 2 * d + SPREAD_FLOOR ** 2 + f.resid ** 2),
    );
    const q = Z.map((z) => round4(invLogit(mu + z * spread)));
    // Rounding must not break the ordering the scorer requires.
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    return { id: t.id, q };
  });
  return { trophies };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const out = forecastCase(c);
  const text = `${JSON.stringify(out)}\n`;
  // Validate the forecast before it leaves: one row per trophy, ids once, five
  // finite quantiles a row, non-decreasing, inside 0..100, file within the cap.
  // A bad row must fail loudly here, never as an invalid case at the grader.
  if (out.trophies.length !== c.trophies.length) {
    throw new Error(`${file}: wrote ${out.trophies.length} rows for ${c.trophies.length} trophies`);
  }
  const seen = new Set<number>();
  for (const row of out.trophies) {
    if (seen.has(row.id)) throw new Error(`${file}: trophy ${row.id} twice`);
    seen.add(row.id);
    if (row.q.length !== LEVELS.length) throw new Error(`${file}: trophy ${row.id} has ${row.q.length} quantiles`);
    for (let j = 0; j < row.q.length; j++) {
      if (!Number.isFinite(row.q[j]) || row.q[j] < 0 || row.q[j] > 100) {
        throw new Error(`${file}: trophy ${row.id} quantile ${j} is ${row.q[j]}`);
      }
      if (j > 0 && row.q[j] < row.q[j - 1]) throw new Error(`${file}: trophy ${row.id} quantiles decrease`);
    }
  }
  if (text.length > 65536) throw new Error(`${file}: output ${text.length} bytes, over the 65,536 cap`);
  const outPath = join(OUTPUT_DIR, `${id}.out`);
  writeFileSync(outPath, text);
  console.error(`wrote ${outPath} (${text.length} bytes, ${out.trophies.length} trophies)`);
}
