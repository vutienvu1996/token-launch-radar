// Token Radar's model, radar-3: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling), every rankable protocol above that floor the watchlist leaves out,
// and every rankable pre-token protocol below the floor. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko
// id, no symbol). Live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through a
// log-size curve fitted on the snapshot's own traded tokens:
//
//   x     = log10(tvl_usd / $100M)
//   base  = 10 ^ (a + b * x)                       (a, b fitted by OLS, see fitModel)
//   implied = base * categoryMult * growthMult * maturityMult
//
// Variant selection (prototype proto_model3.py, all numbers recomputed here
// at run time from the snapshot): three curve forms were fitted and scored by
// leave-one-out and by a time split (fit on tokens listed before 2024, test on
// tokens listed in 2024 or later). (a) pure log-log curve; (b) log-log plus a
// family multiplier per category; (c) the same model written as a multiple
// with a size slope, log10(mcap/TVL) = level + slope*x + family. (b) and (c)
// are the same model re-parameterised: their board predictions agree to
// |log10 ratio| < 0.0001, so the choice is (a) vs (b). (b) wins on LOO median
// miss (2.82x vs 2.86x) and loses by a hair on % within 3x (51.7% vs 52.8%)
// and on the time split (2.50x vs 2.40x); the differences are inside noise,
// and (b) is picked because it keeps the family structure the comparables
// table explains. A "sibling" factor (sharing the first word of its name with
// a traded token) was tested and dropped: only 2 of 89 fitted tokens have
// one, and LOO is unchanged with it (2.82x either way).
//
// The family multiplier is the shrunk median residual of the category's live
// tokens, in log space, shrunk toward 1.0 with a prior of weight 10, and used
// only where a category has at least 4 live comparables (measured: thin
// categories add only noise — restricting to n >= 4 moves LOO median miss
// from 2.99x to 2.82x), clamped to [0.45, 2.20] (the observed shrunk range is
// 0.649x..1.615x, so the clamp binds nothing on this snapshot):
//
//   categoryMult(c) = clamp(10 ^ (n/(n+10) * medianResidual(c)), 0.45, 2.20)  if n >= 4
//                   = 1.0                                                       otherwise
//
// Outliers are removed before the fit by iterative 2.5-sigma clipping on the
// OLS residuals (at most 5 rounds). On this snapshot that removes 3 tokens:
// rain (+2.78), bitway-earn (+2.16) and concentrator (-2.13) in log10.
//
// Growth and age are small priors, not fitted effects: the fitted slopes of
// the category-adjusted residuals on 7-day growth (-0.002 log10 per point,
// r = -0.02) and on log age (+0.18 log10 per dex, r = +0.08) are both
// indistinguishable from zero at n = 89, so neither tilt is allowed to
// dominate. Growth: 1 + 0.10 * clamp(change_7d, -50, 100) / 100 (at most
// +/-10%). Maturity: 0.85 + 0.15 * min(age, 1095) / 1095 (age unknown: 365).
//
// Uncertainty per row comes from the same fit: the P25-P75 band is the
// implied value times the P25/P75 of the category-adjusted residuals, and the
// P10-P90 rank range comes from 200 bootstrap refits (fixed seed 20261116,
// resampling the 89 fitted tokens with replacement and re-ranking the board).
//
// Farm economics are a $1,000-deposit yardstick, not a launch prediction.
// If a launch happened and 10% of it went to depositors pro-rata by TVL, a
// $1,000 deposit would take slice_1k_usd = implied * 10% * $1,000 / TVL.
// Its cost is the farm's gas plus the yield forgone by holding $1,000 out of
// a 4% T-bill for the hold period. Break-even launch odds = cost / slice:
// the launch probability at which expected value is zero. Verdicts: Worth
// farming when break-even odds are at most 25% and net $/hour if a launch
// happens is at least $25; Marginal when break-even odds are at most 50%;
// otherwise Skip. No launch probability is ever invented.
//
// No protocol name is ever special-cased: the same functions score every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Reference TVL for the log-size curve's x: log10(tvl_usd / this). */
  log_tvl_ref_usd: number;
  /** Prior weight (in tokens) shrinking a category's median residual toward 0. */
  shrink_prior: number;
  /** A category needs this many live tokens before its multiplier applies. */
  min_category_n: number;
  /** Clamp on a category multiplier (derived: just outside the observed range). */
  category_mult_floor: number;
  category_mult_cap: number;
  /** Outlier clipping: drop |residual| > this many residual standard deviations. */
  outlier_sigma: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Bootstrap refits for the rank ranges, and their fixed seed. */
  bootstrap_refits: number;
  bootstrap_seed: number;
  /** $1K slice: this share of a launch goes to depositors pro-rata by TVL. */
  slice_depositor_share: number;
  /** The slice yardstick's deposit size in dollars. */
  slice_deposit_usd: number;
  /** Forgone yield rate (T-bill) applied to the deposit over the hold. */
  tbill_rate: number;
  /** Verdict thresholds on break-even launch odds and net $/hour if a launch happens. */
  worth_breakeven: number;
  worth_net_per_hour: number;
  marginal_breakeven: number;
}

export const MODEL: ModelConstants = {
  log_tvl_ref_usd: 100_000_000,
  shrink_prior: 10,
  min_category_n: 4,
  category_mult_floor: 0.45,
  category_mult_cap: 2.2,
  outlier_sigma: 2.5,
  growth_weight: 0.1,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.85,
  maturity_range: 0.15,
  maturity_days: 1095,
  unknown_age_days: 365,
  bootstrap_refits: 200,
  bootstrap_seed: 20261116,
  slice_depositor_share: 0.1,
  slice_deposit_usd: 1000,
  tbill_rate: 0.04,
  worth_breakeven: 0.25,
  worth_net_per_hour: 25,
  marginal_breakeven: 0.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One outlier the 2.5-sigma clip removed from the fit, with its evidence. */
export interface FitOutlier {
  slug: string;
  category: string | null;
  mcap_tvl_ratio: number;
  residual_log10: number;
}

/** The fitted log-size curve and its residuals, recomputed from the snapshot. */
export interface FitStats {
  /** Traded, non-CEX tokens with mcap > 0 and TVL > 0 before exclusions. */
  n_live_candidates: number;
  /** Of those, removed as wrapped, staked, bridged, versioned or exchange products. */
  n_excluded_wrapped: number;
  /** Tokens the curve was fitted on, after outlier clipping. */
  n_fitted: number;
  /** log10(mcap) = intercept + slope * log10(tvl_usd / $100M). */
  intercept: number;
  slope: number;
  /** Implied mcap multiple per 10x TVL: 10 ^ slope. */
  per_10x_tvl: number;
  resid_sd_log10: number;
  resid_p25_log10: number;
  resid_p75_log10: number;
  resid_p10_log10: number;
  resid_p90_log10: number;
  outliers: FitOutlier[];
}

/** Out-of-sample validation, recomputed from the snapshot at run time. */
export interface ValidationStats {
  loo_n: number;
  loo_median_miss: number;
  loo_within_3x_pct: number;
  loo_spearman: number;
  flat_loo_median_miss: number;
  flat_loo_within_3x_pct: number;
  flat_loo_spearman: number;
  time_split_train_n: number;
  time_split_test_n: number;
  time_split_excluded_unknown_n: number;
  time_split_train_intercept: number;
  time_split_train_slope: number;
  time_split_median_miss: number;
  time_split_within_3x_pct: number;
  time_split_spearman: number;
  flat_time_split_median_miss: number;
  flat_time_split_within_3x_pct: number;
  flat_time_split_spearman: number;
}

/** The farm-economics assumptions and the verdict counts they produce. */
export interface FarmMeta {
  slice_depositor_share: number;
  slice_deposit_usd: number;
  tbill_rate: number;
  worth_breakeven: number;
  worth_net_per_hour: number;
  marginal_breakeven: number;
  verdict_worth: number;
  verdict_marginal: number;
  verdict_skip: number;
}

/** Everything about the model the dashboard states, beyond the constants. */
export interface ModelMeta {
  variant_picked: string;
  sibling_test: string;
  fit: FitStats;
  validation: ValidationStats;
  farm: FarmMeta;
}

/** One category's comparables, read off the snapshot's live tokens. */
export interface CategoryComp {
  category: string;
  live_n: number;
  /** Median log10 residual of the category's live tokens; null when none. */
  median_residual_log10: number | null;
  /** The multiplier used: the shrunk median residual as a factor, or 1.0. */
  used: number;
}

/** The comparables table: the global median ratio and one row per category. */
export interface Comparables {
  global_median: number;
  by_category: CategoryComp[];
}

/** How the board covers the snapshot: counts the dashboard states. */
export interface Coverage {
  protocols_total: number;
  pre_token_total: number;
  live_token_total: number;
  watchlist_size: number;
  above_floor_size: number;
  early_size: number;
  board_size: number;
  excluded_total: number;
  excluded: { reason: string; count: number }[];
  live_size: number;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A row's farm economics on the $1,000-deposit slice yardstick. */
export interface FarmEconomics {
  /** Pro-rata slice of a launch for a $1,000 deposit, if 10% goes to depositors. */
  slice_1k_usd: number;
  /** Gas plus forgone 4% T-bill yield on $1,000 over the hold, in dollars. */
  farm_cost_usd: number;
  /** Hours the farm plan takes. */
  farm_hours: number;
  /** Net dollars per hour if a launch happens: (slice - cost) / hours. */
  net_usd_per_hour_if_launch: number;
  /** Launch probability at which expected value is zero: cost / slice. */
  breakeven_launch_probability: number;
  farm_verdict: 'Worth farming' | 'Marginal' | 'Skip';
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
    category_multiple: number;
    comparables_n: number;
    comparables_median_residual_log10: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    /** The log-size curve's value before family, growth and maturity. */
    base_curve_value_usd: number;
    /** P25-P75 band on the implied value, from the fit's residuals. */
    implied_p25_usd: number;
    implied_p75_usd: number;
    /** P10-P90 rank range over the 200 bootstrap refits. */
    rank_p10: number;
    rank_p90: number;
    slice_1k_usd: number;
    farm_cost_usd: number;
    farm_hours: number;
    net_usd_per_hour_if_launch: number;
    breakeven_launch_probability: number;
    farm_verdict: 'Worth farming' | 'Marginal' | 'Skip';
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
  base_curve_value_usd: number;
  category_multiple: number;
  comparables_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  rank_p10: number;
  rank_p90: number;
  slice_1k_usd: number;
  farm_cost_usd: number;
  net_usd_per_hour_if_launch: number;
  breakeven_launch_probability: number;
  farm_verdict: 'Worth farming' | 'Marginal' | 'Skip';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_meta: ModelMeta;
  comparables: Comparables;
  coverage: Coverage;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not list of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The population standard deviation of a list of numbers. */
function pstdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length);
}

/** The q-th quantile of a sorted list, by nearest rank (the prototype's rule). */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
}

/** Pearson correlation of two equal-length lists; 0 when either is constant. */
function corr(u: number[], v: number[]): number {
  const n = u.length;
  if (n === 0) return 0;
  const mu = u.reduce((a, b) => a + b, 0) / n;
  const mv = v.reduce((a, b) => a + b, 0) / n;
  let du = 0;
  let dv = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    du += (u[i]! - mu) * (u[i]! - mu);
    dv += (v[i]! - mv) * (v[i]! - mv);
    cov += (u[i]! - mu) * (v[i]! - mv);
  }
  return du > 0 && dv > 0 ? cov / Math.sqrt(du * dv) : 0;
}

/** Ranks 1..n by descending value; ties break by slug, so the order is deterministic. */
function ranksByValue(items: { value: number; slug: string }[]): Map<string, number> {
  const order = [...items].sort((a, b) => b.value - a.value || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const out = new Map<string, number>();
  order.forEach((it, i) => out.set(it.slug, i + 1));
  return out;
}

/** Spearman rank correlation between two value lists over the same slugs. */
function spearman(actual: { value: number; slug: string }[], predicted: { value: number; slug: string }[]): number {
  const ra = ranksByValue(actual);
  const rp = ranksByValue(predicted);
  const slugs = actual.map((a) => a.slug);
  return corr(
    slugs.map((s) => ra.get(s)!),
    slugs.map((s) => rp.get(s)!),
  );
}

/** A deterministic seeded PRNG (mulberry32): the bootstrap refits must repeat byte for byte. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist's own exclusion list: a wrapped, staked or bridged product is not a launch of its own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** Why a pre-token protocol is not rankable, or null when it is. First reason in this order wins. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'already trades';
  if (p.category === 'CEX') return 'centralised exchange, not a protocol launch';
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product of a token that trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-branded product';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}: a bridged, staked or exchange product`;
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked or bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

/** Whether a traded token may enter the fit: not a wrapped, staked, bridged, versioned or exchange product. */
function isFitEligible(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Ordinary least squares for y = a + b*x; returns [a, b]. */
function ols(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return [my - b * mx, b];
}

/** The log-size x of a protocol: log10(TVL / $100M). */
function logX(p: SnapshotProtocol, model: ModelConstants): number {
  return Math.log10(p.tvl_usd / model.log_tvl_ref_usd);
}

/** One fitted model: its curve, its category residuals, and the tokens it kept. */
interface FittedModel {
  intercept: number;
  slope: number;
  kept: SnapshotProtocol[];
  /** Median log10 residual per category, over the kept tokens. */
  byCategory: Map<string, number[]>;
  /** Category-adjusted residuals of the kept tokens, in fit order. */
  adjustedResiduals: number[];
  outliers: FitOutlier[];
}

/**
 * Fit the log-size curve on traded tokens: OLS on log10(mcap) against
 * log10(TVL / $100M), with iterative 2.5-sigma clipping of the residuals.
 * When `clip` is false the tokens are used as given (the bootstrap's rule).
 */
function fitModel(tokens: SnapshotProtocol[], model: ModelConstants, clip: boolean): FittedModel {
  let kept = [...tokens];
  const outliers: FitOutlier[] = [];
  if (clip) {
    for (let round = 0; round < 5; round++) {
      const [a, b] = ols(
        kept.map((p) => logX(p, model)),
        kept.map((p) => Math.log10(p.mcap_usd!)),
      );
      const res = kept.map((p) => Math.log10(p.mcap_usd!) - (a + b * logX(p, model)));
      const sd = pstdev(res);
      const drop = kept.filter((_, i) => Math.abs(res[i]!) > model.outlier_sigma * sd);
      if (drop.length === 0) break;
      for (const p of drop) {
        const r = Math.log10(p.mcap_usd!) - (a + b * logX(p, model));
        outliers.push({
          slug: p.slug,
          category: p.category,
          mcap_tvl_ratio: round4(p.mcap_usd! / p.tvl_usd),
          residual_log10: round3(r),
        });
      }
      kept = kept.filter((_, i) => Math.abs(res[i]!) <= model.outlier_sigma * sd);
    }
    outliers.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }
  const [intercept, slope] = ols(
    kept.map((p) => logX(p, model)),
    kept.map((p) => Math.log10(p.mcap_usd!)),
  );
  const byCategory = new Map<string, number[]>();
  for (const p of kept) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(Math.log10(p.mcap_usd!) - (intercept + slope * logX(p, model)));
    byCategory.set(key, list);
  }
  const adjustedResiduals = kept.map((p) => {
    const r = Math.log10(p.mcap_usd!) - (intercept + slope * logX(p, model));
    return r - Math.log10(categoryMultiplier(p.category, byCategory, model));
  });
  return { intercept, slope, kept, byCategory, adjustedResiduals, outliers };
}

/** The family multiplier for a category under a fitted model. */
function categoryMultiplier(
  category: string | null,
  byCategory: Map<string, number[]>,
  model: ModelConstants,
): number {
  const values = byCategory.get(category ?? 'Other');
  if (values === undefined || values.length < model.min_category_n) return 1.0;
  const med = median(values) ?? 0;
  const shrunk = (values.length / (values.length + model.shrink_prior)) * med;
  return Math.min(model.category_mult_cap, Math.max(model.category_mult_floor, 10 ** shrunk));
}

/** The comparables: for every category, the shrunk median residual and the multiplier used. */
export function computeComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const fit = fitModel(fitCandidates(snapshot), model, true);
  const live = fit.kept;
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.25;
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  const rows: CategoryComp[] = [...categories].sort().map((category) => {
    const values = fit.byCategory.get(category) ?? [];
    const med = median(values);
    const used = categoryMultiplier(category, fit.byCategory, model);
    return {
      category,
      live_n: values.length,
      median_residual_log10: med === null ? null : round3(med),
      used: round4(used),
    };
  });
  return { global_median: round4(globalMedian), by_category: rows };
}

/** Traded tokens that may enter the fit, before outlier clipping. */
function fitCandidates(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && isFitEligible(p),
  );
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FittedModel,
  model: ModelConstants = MODEL,
): {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  categoryMult: number;
  comparablesN: number;
  comparablesMedianResidual: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const categoryMult = categoryMultiplier(protocol.category, fit.byCategory, model);
  const values = fit.byCategory.get(protocol.category ?? 'Other') ?? [];
  const base = 10 ** (fit.intercept + fit.slope * logX(protocol, model));
  const implied = Math.max(1, Math.round(base * categoryMult * growthMult * maturityMult));
  return {
    implied,
    base,
    growthPct,
    growthMult,
    maturityMult,
    age,
    categoryMult,
    comparablesN: values.length,
    comparablesMedianResidual: median(values) === null ? null : round3(median(values)!),
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A row's farm economics on the $1,000-deposit slice yardstick. */
export function farmEconomics(p: SnapshotProtocol, implied: number, age: number | null, model: ModelConstants = MODEL): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = (capital >= 150 ? 8 : 4) + 2 * weeks;
  const forgone = (model.slice_deposit_usd * model.tbill_rate * hold) / 365;
  const cost = gas + forgone;
  const hours = 15 / 60 + (10 * weeks) / 60 + 5 / 60 + 10 / 60;
  const slice = p.tvl_usd > 0 ? (implied * model.slice_depositor_share * model.slice_deposit_usd) / p.tvl_usd : 0;
  const netPerHour = (slice - cost) / hours;
  const breakeven = slice > 0 ? cost / slice : Number.POSITIVE_INFINITY;
  const verdict: FarmEconomics['farm_verdict'] =
    breakeven <= model.worth_breakeven && netPerHour >= model.worth_net_per_hour
      ? 'Worth farming'
      : breakeven <= model.marginal_breakeven
        ? 'Marginal'
        : 'Skip';
  return {
    slice_1k_usd: round2(slice),
    farm_cost_usd: round2(cost),
    farm_hours: round2(hours),
    net_usd_per_hour_if_launch: round2(netPerHour),
    breakeven_launch_probability: Number.isFinite(breakeven) ? round4(breakeven) : 9999,
    farm_verdict: verdict,
  };
}

/** Leave-one-out validation on the fitted tokens, plus the time-split test. */
function validateModel(snapshot: Snapshot, fit: FittedModel, model: ModelConstants): ValidationStats {
  const kept = fit.kept;
  // Leave-one-out: refit the curve and the family multipliers without each
  // token (the outlier set stays the one the full fit found), and score it.
  const looMiss: number[] = [];
  let looWithin3 = 0;
  const looActual: { value: number; slug: string }[] = [];
  const looPred: { value: number; slug: string }[] = [];
  const flatPred: { value: number; slug: string }[] = [];
  const flatMiss: number[] = [];
  let flatWithin3 = 0;
  for (let i = 0; i < kept.length; i++) {
    const rest = kept.filter((_, j) => j !== i);
    const refit = fitModel(rest, model, false);
    const p = kept[i]!;
    const v = impliedValue(p, snapshot.as_of, refit, model);
    const act = p.mcap_usd!;
    const miss = Math.max(v.implied / act, act / v.implied);
    looMiss.push(miss);
    if (miss <= 3) looWithin3++;
    looActual.push({ value: act, slug: p.slug });
    looPred.push({ value: v.implied, slug: p.slug });
    const glob = median(rest.map((q) => q.mcap_usd! / q.tvl_usd)) ?? 0.25;
    const flat = Math.max(1, Math.round(p.tvl_usd * glob * v.growthMult * v.maturityMult));
    const fmiss = Math.max(flat / act, act / flat);
    flatMiss.push(fmiss);
    if (fmiss <= 3) flatWithin3++;
    flatPred.push({ value: flat, slug: p.slug });
  }
  // Time split: fit on tokens listed before 2024 (with the same clipping),
  // test on tokens listed in 2024 or later; no listed_at means excluded.
  const train = kept.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const test = kept.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  const unknownN = kept.filter((p) => p.listed_at === null).length;
  const trainFit = fitModel(train, model, true);
  const tsMiss: number[] = [];
  let tsWithin3 = 0;
  const tsActual: { value: number; slug: string }[] = [];
  const tsPred: { value: number; slug: string }[] = [];
  const tsFlatPred: { value: number; slug: string }[] = [];
  const tsFlatMiss: number[] = [];
  let tsFlatWithin3 = 0;
  const globTrain = median(trainFit.kept.map((q) => q.mcap_usd! / q.tvl_usd)) ?? 0.25;
  for (const p of test) {
    const v = impliedValue(p, snapshot.as_of, trainFit, model);
    const act = p.mcap_usd!;
    const miss = Math.max(v.implied / act, act / v.implied);
    tsMiss.push(miss);
    if (miss <= 3) tsWithin3++;
    tsActual.push({ value: act, slug: p.slug });
    tsPred.push({ value: v.implied, slug: p.slug });
    const flat = Math.max(1, Math.round(p.tvl_usd * globTrain * v.growthMult * v.maturityMult));
    const fmiss = Math.max(flat / act, act / flat);
    tsFlatMiss.push(fmiss);
    if (fmiss <= 3) tsFlatWithin3++;
    tsFlatPred.push({ value: flat, slug: p.slug });
  }
  const pct = (n: number, d: number): number => (d === 0 ? 0 : round2((100 * n) / d));
  return {
    loo_n: kept.length,
    loo_median_miss: round2(median(looMiss) ?? 0),
    loo_within_3x_pct: pct(looWithin3, kept.length),
    loo_spearman: round3(spearman(looActual, looPred)),
    flat_loo_median_miss: round2(median(flatMiss) ?? 0),
    flat_loo_within_3x_pct: pct(flatWithin3, kept.length),
    flat_loo_spearman: round3(spearman(looActual, flatPred)),
    time_split_train_n: trainFit.kept.length,
    time_split_test_n: test.length,
    time_split_excluded_unknown_n: unknownN,
    time_split_train_intercept: round4(trainFit.intercept),
    time_split_train_slope: round4(trainFit.slope),
    time_split_median_miss: round2(median(tsMiss) ?? 0),
    time_split_within_3x_pct: pct(tsWithin3, test.length),
    time_split_spearman: round3(spearman(tsActual, tsPred)),
    flat_time_split_median_miss: round2(median(tsFlatMiss) ?? 0),
    flat_time_split_within_3x_pct: pct(tsFlatWithin3, test.length),
    flat_time_split_spearman: round3(spearman(tsActual, tsFlatPred)),
  };
}

/** P10-P90 rank ranges over bootstrap refits of the fitted curve. */
function bootstrapRankRanges(
  boardProtocols: SnapshotProtocol[],
  fit: FittedModel,
  asOf: string,
  model: ModelConstants,
): Map<string, { p10: number; p90: number }> {
  const rng = mulberry32(model.bootstrap_seed);
  const kept = fit.kept;
  const ranksBySlug = new Map<string, number[]>();
  for (let it = 0; it < model.bootstrap_refits; it++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < kept.length; i++) sample.push(kept[Math.floor(rng() * kept.length)]!);
    const refit = fitModel(sample, model, false);
    const scored = boardProtocols.map((p) => ({ value: impliedValue(p, asOf, refit, model).implied, slug: p.slug }));
    const ranks = ranksByValue(scored);
    for (const [slug, rank] of ranks) {
      const list = ranksBySlug.get(slug) ?? [];
      list.push(rank);
      ranksBySlug.set(slug, list);
    }
  }
  const out = new Map<string, { p10: number; p90: number }>();
  for (const [slug, list] of ranksBySlug) {
    const sorted = [...list].sort((a, b) => a - b);
    out.set(slug, { p10: quantileSorted(sorted, 0.1), p90: quantileSorted(sorted, 0.9) });
  }
  return out;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitModel(fitCandidates(snapshot), model, true);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Above the floor, the watchlist leaves some rankable protocols out (a
  // parent protocol's child, a name the rule did not catch): the floor is
  // never the ceiling, so they rank too. Below it, every rankable protocol.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const sortedResid = [...fit.adjustedResiduals].sort((a, b) => a - b);
  const p25 = quantileSorted(sortedResid, 0.25);
  const p75 = quantileSorted(sortedResid, 0.75);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const econ = farmEconomics(p, v.implied, v.age, model);
    return { p, ...v, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const ranges = bootstrapRankRanges(scored.map((s) => s.p), fit, snapshot.as_of, model);
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug) ?? { p10: i + 1, p90: i + 1 };
    return {
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
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        category_multiple: round4(s.categoryMult),
        comparables_n: s.comparablesN,
        comparables_median_residual_log10: s.comparablesMedianResidual,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
        base_curve_value_usd: Math.max(1, Math.round(s.base)),
        implied_p25_usd: Math.max(1, Math.round(s.implied * 10 ** p25)),
        implied_p75_usd: Math.max(1, Math.round(s.implied * 10 ** p75)),
        rank_p10: range.p10,
        rank_p90: range.p90,
        slice_1k_usd: s.econ.slice_1k_usd,
        farm_cost_usd: s.econ.farm_cost_usd,
        farm_hours: s.econ.farm_hours,
        net_usd_per_hour_if_launch: s.econ.net_usd_per_hour_if_launch,
        breakeven_launch_probability: s.econ.breakeven_launch_probability,
        farm_verdict: s.econ.farm_verdict,
      },
      farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
    };
  });
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Use ${name} on ${chain}: bridge $${capital} of USDC in and make one transaction a week in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. Step five states the honest
 * limit: the snapshot records no token and no points program for this
 * protocol, so the farm is the usage itself, not a promised airdrop — and it
 * carries the row's $1,000-slice economics, so a reader sees the break-even
 * launch odds before spending anything.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const bePct = econ.breakeven_launch_probability >= 100 ? 'over 100' : (econ.breakeven_launch_probability * 100).toFixed(1);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `The snapshot records no token and no points program for ${p.name}, so farm the usage, not a promised airdrop. On a $1,000 deposit the pro-rata slice would be $${econ.slice_1k_usd} if 10% of a launch went to depositors, against $${econ.farm_cost_usd} of gas and forgone yield, so it breaks even only if the launch chance is above ${bePct}% — verdict: ${econ.farm_verdict}. Before you withdraw, open the protocol's own rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
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
    base_curve_value_usd: row.model.base_curve_value_usd,
    category_multiple: row.model.category_multiple,
    comparables_n: row.model.comparables_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    implied_p25_usd: row.model.implied_p25_usd,
    implied_p75_usd: row.model.implied_p75_usd,
    rank_p10: row.model.rank_p10,
    rank_p90: row.model.rank_p90,
    slice_1k_usd: row.model.slice_1k_usd,
    farm_cost_usd: row.model.farm_cost_usd,
    net_usd_per_hour_if_launch: row.model.net_usd_per_hour_if_launch,
    breakeven_launch_probability: row.model.breakeven_launch_probability,
    farm_verdict: row.model.farm_verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = computeComparables(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const above = board.filter((r) => !watchlist.has(r.slug) && r.tvl_usd >= snapshot.floor_usd).length;
  const early = board.filter((r) => !watchlist.has(r.slug) && r.tvl_usd < snapshot.floor_usd).length;
  const preToken = snapshot.protocols.filter(isPreToken);
  const excludedCount = new Map<string, number>();
  for (const p of preToken) {
    const reason = exclusionReason(p);
    if (reason !== null) excludedCount.set(reason, (excludedCount.get(reason) ?? 0) + 1);
  }
  const excluded = [...excludedCount.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
  const coverage: Coverage = {
    protocols_total: snapshot.protocols.length,
    pre_token_total: preToken.length,
    live_token_total: snapshot.protocols.length - preToken.length,
    watchlist_size: snapshot.watchlist.length,
    above_floor_size: above,
    early_size: early,
    board_size: board.length,
    excluded_total: preToken.length - board.length,
    excluded,
    live_size: live.length,
  };
  // Fit and validation, recomputed here so the dashboard states measured numbers.
  const candidates = fitCandidates(snapshot);
  const fit = fitModel(candidates, model, true);
  const validation = validateModel(snapshot, fit, model);
  const sortedResid = [...fit.adjustedResiduals].sort((a, b) => a - b);
  const verdictCounts = { worth: 0, marginal: 0, skip: 0 };
  for (const r of board) {
    if (r.model.farm_verdict === 'Worth farming') verdictCounts.worth++;
    else if (r.model.farm_verdict === 'Marginal') verdictCounts.marginal++;
    else verdictCounts.skip++;
  }
  const modelMeta: ModelMeta = {
    variant_picked:
      'log-log size curve + family multiplier (n>=4 live tokens, shrink prior 10, clamp 0.45-2.20); ' +
      'picked over the pure curve by LOO median miss (2.82x vs 2.86x) — see MODEL3_REPORT.md for the full variant table',
    sibling_test:
      'sibling factor (first word of name shared with a traded token) tested and dropped: 2 of 89 fitted tokens have one, LOO unchanged at 2.82x',
    fit: {
      n_live_candidates: candidates.length,
      n_excluded_wrapped: snapshot.protocols.filter(
        (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
      ).length - candidates.length,
      n_fitted: fit.kept.length,
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      per_10x_tvl: round3(10 ** fit.slope),
      resid_sd_log10: round4(pstdev(fit.adjustedResiduals)),
      resid_p25_log10: round3(quantileSorted(sortedResid, 0.25)),
      resid_p75_log10: round3(quantileSorted(sortedResid, 0.75)),
      resid_p10_log10: round3(quantileSorted(sortedResid, 0.1)),
      resid_p90_log10: round3(quantileSorted(sortedResid, 0.9)),
      outliers: fit.outliers,
    },
    validation,
    farm: {
      slice_depositor_share: model.slice_depositor_share,
      slice_deposit_usd: model.slice_deposit_usd,
      tbill_rate: model.tbill_rate,
      worth_breakeven: model.worth_breakeven,
      worth_net_per_hour: model.worth_net_per_hour,
      marginal_breakeven: model.marginal_breakeven,
      verdict_worth: verdictCounts.worth,
      verdict_marginal: verdictCounts.marginal,
      verdict_skip: verdictCounts.skip,
    },
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_meta: modelMeta,
    comparables,
    coverage,
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
  // The source names the fetch endpoint; the dashboard carries no network
  // address, so only the fetch time is kept, read out of the source string.
  const at = /fetched (\S+)/.exec(radar.source)?.[1] ?? `${radar.as_of}T00:00:00Z`;
  const clean: RadarData = { ...radar, source: `DefiLlama public protocols API, fetched ${at}` };
  return `window.RADAR=${JSON.stringify(clean)};\n`;
}
