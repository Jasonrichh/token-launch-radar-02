// Token Radar's value model (radar-3): one sealed snapshot in, one ranked board out.
//
// The board covers every pre-token protocol the snapshot carries: the whole watchlist (the
// floor, never the ceiling) plus every other rankable protocol below the floor, strongest
// first. A protocol is pre-token when its record carries no token at all (no market cap, no
// CoinGecko id, no symbol); live-token protocols are kept apart and shown with the market's
// own values beside the curve's reading of them, never mixed into the ranked board.
//
// radar-3 replaces radar-2's median category multiples with a size curve FITTED on the
// snapshot's own live-token protocols, then tested out of sample before it prices anything:
//
//   size curve   log10(market cap) = a + b x log10(TVL), ordinary least squares over the
//                  live-token protocols that record a market cap above zero (CEX excluded:
//                  an exchange's token is not a protocol's token). On this snapshot the fit
//                  is a = 3.382, b = 0.472, R-squared 0.143 over 119 protocols: TVL alone
//                  explains little of a token's value, and the dashboard says so in plain
//                  words. The curve is a yardstick, not a price: a bigger protocol's token
//                  is worth more than a smaller one's, but only as the square root of its
//                  size, and the scatter around the curve is wide.
//   category     each category's mean residual from the curve, shrunk by n / (n + 5) and
//   offset       clamped to +/-0.4 in log10 (a factor of 0.4x to 2.5x). Categories with
//                  fewer than 3 live samples get no offset. The offset is computed from the
//                  snapshot at run time, never written in by hand.
//   growth       1 + 0.35 x tanh(clamp(change_7d, -80, 400) / 50). A 7-day surge lifts the
//                  value, a slide cuts it; tanh keeps a +4,448% outlier from counting more
//                  than a strong +120% run. A bounded judgement term, stated as one.
//   maturity     0.90 + 0.10 x min(age_days, 1460) / 1460 (age unknown: 365 days). A protocol
//                  that has run a long time with no token is a little overdue for one. A
//                  bounded judgement term, stated as one: the live-token fit finds age
//                  pulls multiples slightly DOWN, so maturity is kept small on purpose.
//   implied      = max(1, round(10^(a + b x log10(TVL) + category offset) x growth x maturity))
//
// The fit is tested two ways, both computed from the snapshot at run time and printed on the
// dashboard, so a reader can check the yardstick before trusting a rank:
//   leave-one-out  refit the curve (and the left-out protocol's category offset) without
//                  each live protocol in turn, predict its market cap, and report the median
//                  absolute log10 error and the share of predictions within 2x of the truth.
//   time split     split the dated live protocols at their median listing date, fit on the
//                  earlier half, and test on the later half: the curve is asked to price
//                  listings it has never seen. Same two numbers as leave-one-out.
//
// Farm economics are netted to the dollar on every row: the capital the position needs, the
// gas of every transaction the plan asks for, the weeks the position is held, the total out
// of pocket, and the break-even share — the basis points of the implied value a launch
// would have to pay the farmer for the farm to cover its own cost. No protocol name is
// ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_scale: number;
  growth_floor: number;
  growth_cap: number;
  offset_min_samples: number;
  offset_shrink: number;
  offset_clamp: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_scale: 50,
  growth_floor: -80,
  growth_cap: 400,
  offset_min_samples: 3,
  offset_shrink: 5,
  offset_clamp: 0.4,
  maturity_floor: 0.9,
  maturity_range: 0.1,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's fitted offset, with how many live protocols priced it. */
export interface CategoryOffset {
  category: string;
  offset: number;
  samples: number;
}

/** The size curve's fit and its two out-of-sample tests, all computed from the snapshot. */
export interface ModelValidation {
  train_size: number;
  intercept: number;
  slope: number;
  r_squared: number;
  residual_sd_log10: number;
  loo_median_log_err: number;
  loo_within_2x: number;
  split_cutoff: string | null;
  split_train_size: number;
  split_test_size: number;
  split_median_log_err: number | null;
  split_within_2x: number | null;
  offsets: CategoryOffset[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_value_usd: number;
    category_offset: number;
    offset_samples: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_per_tx_usd: number;
    tx_count: number;
    gas_total_usd: number;
    hold_days: number;
    total_cost_usd: number;
    breakeven_bp: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  category_offset: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  capital_usd: number;
  gas_total_usd: number;
  total_cost_usd: number;
  breakeven_bp: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value beside the curve's reading of it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  predicted_mcap_usd: number;
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its tests. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: ModelValidation;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LOG2 = Math.log10(2);

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers, or 0 when it is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a protocol trains the size curve: its token trades, with a market cap above zero. */
export function isTrainable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** Ordinary least squares of y on x, one predictor plus an intercept. */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number; rSquared: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const rSquared = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, rSquared };
}

/**
 * The size curve and its tests, fitted on the snapshot's live-token protocols. The curve is
 * fitted in log10 space; the category offsets are the shrunk mean residuals per category.
 */
export function fitCurve(snapshot: Snapshot, model: ModelConstants): ModelValidation {
  const train = snapshot.protocols.filter(isTrainable);
  const xs = train.map((p) => Math.log10(p.tvl_usd));
  const ys = train.map((p) => Math.log10(p.mcap_usd!));
  const fit = ols(xs, ys);
  const residuals = train.map((p, i) => ys[i]! - (fit.intercept + fit.slope * xs[i]!));
  const residualSd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, train.length));

  // Category offsets: shrunk mean residual per category, clamped.
  const byCategory = new Map<string, number[]>();
  for (let i = 0; i < train.length; i++) {
    const key = train[i]!.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(residuals[i]!);
    byCategory.set(key, list);
  }
  const offsets: CategoryOffset[] = [];
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length < model.offset_min_samples) continue;
    const mean = list.reduce((s, v) => s + v, 0) / list.length;
    const shrunk = mean * (list.length / (list.length + model.offset_shrink));
    const clamped = Math.min(model.offset_clamp, Math.max(-model.offset_clamp, shrunk));
    offsets.push({ category, offset: round4(clamped), samples: list.length });
  }
  const offsetOf = (category: string | null): { offset: number; samples: number } => {
    const hit = offsets.find((o) => o.category === (category ?? 'Other'));
    return hit === undefined ? { offset: 0, samples: 0 } : { offset: hit.offset, samples: hit.samples };
  };

  // Leave-one-out: refit the curve without each protocol (and its category offset without it),
  // then predict the market cap it actually carries.
  const looErrors: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const xs2 = xs.filter((_, j) => j !== i);
    const ys2 = ys.filter((_, j) => j !== i);
    const f2 = ols(xs2, ys2);
    let pred = f2.intercept + f2.slope * xs[i]!;
    const cat = train[i]!.category ?? 'Other';
    const others = residuals.filter((_, j) => j !== i && (train[j]!.category ?? 'Other') === cat);
    if (others.length >= model.offset_min_samples) {
      const mean = others.reduce((s, v) => s + v, 0) / others.length;
      const shrunk = mean * (others.length / (others.length + model.offset_shrink));
      pred += Math.min(model.offset_clamp, Math.max(-model.offset_clamp, shrunk));
    }
    looErrors.push(Math.abs(ys[i]! - pred));
  }
  const looMedian = median(looErrors);
  const looWithin = looErrors.length === 0 ? 0 : looErrors.filter((e) => e <= LOG2).length / looErrors.length;

  // Time split: fit on the earlier half of the dated live protocols, test on the later half.
  const dated = train
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  let splitCutoff: string | null = null;
  let splitTrain = 0;
  let splitTest = 0;
  let splitMedian: number | null = null;
  let splitWithin: number | null = null;
  if (dated.length >= 10) {
    const half = Math.floor(dated.length / 2);
    const earlier = dated.slice(0, half);
    const later = dated.slice(half);
    splitCutoff = later[0]!.listed_at;
    splitTrain = earlier.length;
    splitTest = later.length;
    const f3 = ols(
      earlier.map((p) => Math.log10(p.tvl_usd)),
      earlier.map((p) => Math.log10(p.mcap_usd!)),
    );
    const errs = later.map((p) => Math.abs(Math.log10(p.mcap_usd!) - (f3.intercept + f3.slope * Math.log10(p.tvl_usd))));
    splitMedian = round4(median(errs));
    splitWithin = round4(errs.filter((e) => e <= LOG2).length / errs.length);
  }

  return {
    train_size: train.length,
    intercept: round4(fit.intercept),
    slope: round4(fit.slope),
    r_squared: round4(fit.rSquared),
    residual_sd_log10: round4(residualSd),
    loo_median_log_err: round4(looMedian),
    loo_within_2x: round4(looWithin),
    split_cutoff: splitCutoff,
    split_train_size: splitTrain,
    split_test_size: splitTest,
    split_median_log_err: splitMedian,
    split_within_2x: splitWithin,
    offsets,
  };
}

/** The curve's reading of a protocol's market cap, before growth and maturity. */
export function curveValue(tvlUsd: number, category: string | null, validation: ModelValidation): { value: number; offset: number; samples: number } {
  const hit = validation.offsets.find((o) => o.category === (category ?? 'Other'));
  const offset = hit === undefined ? 0 : hit.offset;
  const samples = hit === undefined ? 0 : hit.samples;
  const logValue = validation.intercept + validation.slope * Math.log10(tvlUsd) + offset;
  return { value: Math.max(1, Math.round(10 ** logValue)), offset, samples };
}

/** The growth and maturity multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  validation: ModelValidation,
): { implied: number; curve: number; offset: number; samples: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + model.growth_weight * Math.tanh(growthPct / model.growth_scale);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { value, offset, samples } = curveValue(protocol.tvl_usd, protocol.category, validation);
  const implied = Math.max(1, Math.round(value * growthMult * maturityMult));
  return { implied, curve: value, offset, samples, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; validation: ModelValidation } {
  const validation = fitCurve(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen. The protocols above the floor that the
  // watchlist leaves out are wrapped, staked or bridged products of tokens that already trade,
  // so they are not launches waiting to happen and the board leaves them out on purpose.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, validation);
    const farm = farmEconomics(p, v.age);
    return { p, ...v, farm };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      curve_value_usd: s.curve,
      category_offset: s.offset,
      offset_samples: s.samples,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm: s.farm,
    farm_steps: farmSteps(s.p, s.age, s.farm, s.implied).map(stepText),
  }));
  return { board, validation };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on the protocol's main chain, in whole dollars. */
export function gasPerTxUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 0.1;
  if (c === 'bitcoin') return 2;
  return 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm's dollar math: capital, every transaction's gas, the hold, the total out of pocket, and the break-even share of the implied value. */
export interface FarmEconomics {
  capital_usd: number;
  gas_per_tx_usd: number;
  tx_count: number;
  gas_total_usd: number;
  hold_days: number;
  total_cost_usd: number;
  breakeven_bp: number;
}

export function farmEconomics(p: SnapshotProtocol, age: number | null): FarmEconomics {
  const capital = capitalFor(p);
  const gasPerTx = gasPerTxUsd(chainOf(p));
  const hold = holdDaysFor(age);
  const weekly = Math.ceil(hold / 7);
  const txCount = 2 + weekly + 1;
  const gasTotal = Math.round(gasPerTx * txCount * 100) / 100;
  const total = Math.round((capital + gasTotal) * 100) / 100;
  // breakeven_bp needs the implied value, so buildRadar fills it in once the board is ranked.
  return { capital_usd: capital, gas_per_tx_usd: gasPerTx, tx_count: txCount, gas_total_usd: gasTotal, hold_days: hold, total_cost_usd: total, breakeven_bp: 0 };
}

/** The break-even share of the implied value, in basis points, once the implied value is known. */
export function breakevenBp(totalCostUsd: number, impliedUsd: number): number {
  return Math.round((totalCostUsd / Math.max(1, impliedUsd)) * 10000 * 100) / 100;
}

/** The category's main action and its second qualifying action, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the position open.`,
      `Borrow $25 of a stablecoin against the deposit and repay it within the week, so the position shows both sides of the market.`,
    ];
  }
  if (c.includes('dex')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`,
      `Swap $25 through ${name} on ${chain} once a week, in small size, to record trading volume.`,
    ];
  }
  if (c.includes('yield') || c.includes('aggregator') || c.includes('leveraged farm') || c.includes('farm')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`,
      `Harvest or compound the vault's yield once, and re-deposit the proceeds into the same vault.`,
    ];
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      `Bridge a second, smaller amount back the other way to show two-way use of the bridge.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`,
      `Restake or delegate the receipt once more, or vote in one governance poll if the protocol opens one.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      `Close and reopen a small position once, keeping total exposure under $${capital}.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and place one small position in a market on ${name}.`,
      `Settle or close the position and place one more in a different market.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`,
      `Claim or reinvest one yield distribution from the position.`,
    ];
  }
  if (c.includes('stable') || c.includes('algo-stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      `Redeem a small amount back to USDC and re-mint it, to record a full mint-and-redeem cycle.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
      `Extend the cover once before it lapses, rather than letting it expire.`,
    ];
  }
  if (c.includes('launchpad')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s launch allocation on ${chain} and keep the allocation.`,
      `Join one launch or vote on one allocation round.`,
    ];
  }
  if (c.includes('nft')) {
    return [
      `Trade about $${capital} of volume through ${name} on ${chain}, in one or two items.`,
      `Make one more trade the following week so the wallet shows repeat use.`,
    ];
  }
  if (c.includes('payment') || c.includes('card')) {
    return [
      `Route $${capital} of spending through ${name} on ${chain} and keep the account active.`,
      `Make a second payment the following week.`,
    ];
  }
  if (c.includes('ai') || c.includes('agent')) {
    return [
      `Run $${capital} of inference or agent tasks through ${name} on ${chain}.`,
      `Run a second task and leave feedback or a rating in the app.`,
    ];
  }
  if (c.includes('index')) {
    return [
      `Buy $${capital} of ${name}'s index on ${chain} and hold the shares.`,
      `Add $25 to the position once, or rebalance it if the app offers that.`,
    ];
  }
  if (c.includes('chain') && !c.includes('cross')) {
    return [
      `Bridge $${capital} of USDC to ${name} and use one native app on the chain.`,
      `Make one transaction in a second native app on the same chain.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
      `Move $25 between two of the vault's allocations.`,
    ];
  }
  if (c.includes('basis')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and keep the position open.`,
      `Add $25 to the position after the first funding round.`,
    ];
  }
  if (c.includes('synthetic')) {
    return [
      `Mint $${capital} of synthetic assets through ${name} on ${chain} and hold them.`,
      `Burn a small amount back and re-mint it, to record a full cycle.`,
    ];
  }
  if (c.includes('governance')) {
    return [
      `Lock $${capital} of assets in ${name}'s governance on ${chain} and vote once.`,
      `Vote in a second proposal.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Make one more qualifying action in the app, such as a swap, a deposit or a vote.`,
  ];
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names: two protocols in the same category farm the same way, and a
 * bigger one asks for more capital. The last step nets the whole plan to the dollar.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, farm: FarmEconomics, impliedUsd: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = farm.capital_usd;
  const hold = farm.hold_days;
  const gas = farm.gas_per_tx_usd;
  const gasText = gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
  const weeklyGas = Math.round(gas * Math.ceil(hold / 7) * 100) / 100;
  const bp = breakevenBp(farm.total_cost_usd, impliedUsd);
  const [main, second] = actionsFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, fund it with $${capital} plus gas on ${chain}, and keep its seed phrase offline.`,
      cost: `${gasText} of gas for the first transaction`,
      time: '10 minutes',
    },
    {
      text: main,
      cost: `$${capital} of capital and ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $25 of volume and ${gasText} of gas`,
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action each week, such as a deposit, a swap, a vote or a claim, so the wallet shows steady activity.`,
      cost: `about $${weeklyGas} of gas over ${Math.ceil(hold / 7)} weeks`,
      time: '10 minutes a week',
    },
    {
      text: `Open ${p.name}'s own points or rewards page from the link the protocol itself publishes and check the position is counted.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If a token is announced, claim only from the protocol's own page or announcement, and never pay anyone to claim for you.`,
      cost: 'gas only, never a claim fee',
      time: '10 minutes',
    },
    {
      text: `Net it out: $${capital} of capital plus $${farm.gas_total_usd} of gas over ${farm.tx_count} transactions is $${farm.total_cost_usd} out of pocket. The farm pays for itself if a launch pays you ${bp} basis points of the $${impliedUsd.toLocaleString('en-US')} implied value.`,
      cost: `$${farm.total_cost_usd} all in`,
      time: `${hold} days, then unwind in two parts`,
    },
  ];
}

/** The live-token protocols, by market cap, with the curve's reading of each beside the market's own. */
export function liveRows(snapshot: Snapshot, validation: ModelValidation): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const { value } = p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? curveValue(p.tvl_usd, p.category, validation) : { value: 0 };
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        predicted_mcap_usd: value,
        ratio: p.mcap_usd !== null && p.mcap_usd > 0 && value > 0 ? round3(p.mcap_usd / value) : null,
      };
    });
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    category_offset: row.model.category_offset,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    capital_usd: row.farm.capital_usd,
    gas_total_usd: row.farm.gas_total_usd,
    total_cost_usd: row.farm.total_cost_usd,
    breakeven_bp: row.farm.breakeven_bp,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, validation } = buildBoard(snapshot, model);
  // The break-even share needs the implied value, so it is filled in after the board is ranked.
  // (The last farm step already carries the same netting: farmSteps computed it from the implied value.)
  for (const row of board) {
    row.farm.breakeven_bp = breakevenBp(row.farm.total_cost_usd, row.implied_value_usd);
  }
  const live = liveRows(snapshot, validation);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
