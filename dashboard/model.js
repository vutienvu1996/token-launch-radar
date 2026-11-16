/* Portable radar-3 port (browser+node). FIELD MAP: app.js reads row fields
   through F; radar-3 names win, else these derive them from v1 fields.
   base=10^(a+b*log10(TVL/$100M)); implied=round(base x family x growth x
   seasoning); family=clamp(10^(n/(n+10) x med residual),.45,2.2) n>=4 else
   1; growth=1+.10 x clamp(7d,-50,100)/100; seasoning=.85+.15 x
   min(age,1095)/1095 (age? 365). Farm ($1,000): slice=implied x 10% x
   $1,000/TVL; cost=gas+4% T-bill forgone; break-even=cost/slice; Worth if
   be<=25% and net/h>=$25, Marginal if be<=50%, else Skip. */
(function (g) {
  'use strict';
  var M = {};
  M.clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var r4 = function (n) { return Math.round(n * 1e4) / 1e4; };
  /* radar-3 value from the fit. */
  M.r3 = function (r, P, catMult) {
    var base = Math.pow(10, P.a + P.b * Math.log10(Math.max(r.tvl_usd, 1) / P.ref));
    var gr = 1 + P.gw * M.clamp(r.change_7d == null ? 0 : r.change_7d, -50, 100) / 100;
    var age = r.age_days == null ? 365 : r.age_days;
    var mt = (1 - P.ageTilt) + P.ageTilt * (Math.min(Math.max(age, 0), 1095) / 1095);
    return { implied: Math.max(1, Math.round(base * catMult * gr * mt)), base: base, growth: gr, maturity: mt };
  };
  /* Family multiplier from one comparables entry. */
  M.catMult = function (c, prior) {
    if (!c || c.live_n < 4 || c.median_residual_log10 == null) return 1;
    return M.clamp(Math.pow(10, (c.live_n / (c.live_n + prior)) * c.median_residual_log10), 0.45, 2.2);
  };
  /* Page recompute of a radar-3 row from stored fields. */
  M.r3check = function (r) {
    return Math.max(1, Math.round(r.base_curve_value_usd * r.category_multiple * r.growth_multiplier * r.maturity_multiplier));
  };
  /* v1 board model (radar-2 fallback). */
  M.v1 = function (r, md) {
    var gr = M.clamp(r.change_7d == null ? 0 : r.change_7d, md.growth_floor, md.growth_cap);
    var gm = 1 + (gr / 100) * md.growth_weight;
    var age = r.age_days == null ? md.unknown_age_days : r.age_days;
    var mm = md.maturity_floor + (Math.min(Math.max(age, 0), md.maturity_days) / md.maturity_days) * md.maturity_range;
    return { implied: Math.max(1, Math.round(r.tvl_usd * r.category_multiple * gm * mm)), growth: gr, growthMult: gm, maturity: mm, age: age };
  };
  /* OLS log10 value ~ log10(TVL/ref); sandbox default when no meta. */
  M.fit = function (pts, ref) {
    var xs = [], ys = [], i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.tvl_usd > 0 && (p.mcap_usd > 0 || p.implied_value_usd > 0)) {
        xs.push(Math.log10(p.tvl_usd / ref));
        ys.push(Math.log10(p.mcap_usd > 0 ? p.mcap_usd : p.implied_value_usd));
      }
    }
    var n = xs.length;
    if (n < 5) return null;
    var mx = 0, my = 0, sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var b = sxx ? sxy / sxx : 0.5;
    return { a: my - b * mx, b: b, n: n };
  };
  /* Band/rank fallbacks (no meta): fixed 2x spread. */
  M.band = function (imp) { return [Math.max(1, Math.round(imp / 2)), Math.round(imp * 2)]; };
  M.rankBand = function (rank, n) {
    var d = Math.max(1, Math.round(rank * 0.12));
    return [Math.max(1, rank - d), Math.min(n, rank + d)];
  };
  /* Farm economics: exact port of lib/model.ts. */
  M.capital = function (tvl) { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; };
  M.hold = function (age) { return age == null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30; };
  M.farm = function (r, imp) {
    var cap = M.capital(r.tvl_usd), hold = M.hold(r.age_days), wk = Math.ceil(hold / 7);
    var gas = (cap >= 150 ? 8 : 4) + 2 * wk;
    var forg = (1000 * 0.04 * hold) / 365;
    var cost = gas + forg;
    var hrs = 15 / 60 + (10 * wk) / 60 + 5 / 60 + 10 / 60;
    var slice = r.tvl_usd > 0 ? (imp * 0.1 * 1000) / r.tvl_usd : 0;
    var net = (slice - cost) / hrs;
    var be = slice > 0 ? cost / slice : Infinity;
    var v = be <= 0.25 && net >= 25 ? 'Worth' : be <= 0.5 ? 'Marginal' : 'Skip';
    return { cap: cap, hold: hold, wk: wk, gas: gas, forg: forg, cost: cost, hrs: hrs, slice: slice, net: net, be: be, verdict: v, slice2: r2(slice), cost2: r2(cost), hrs2: r2(hrs), net2: r2(net), be4: isFinite(be) ? r4(be) : 9999 };
  };
  M.action = function (r, cap, ch) {
    var c = (r.category || '').toLowerCase(), n = r.name;
    if (/lend|cdp|collateral/.test(c)) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + ch + ' and hold.';
    if (/dex|yield|leveraged farm/.test(c)) return 'Provide $' + cap + ' of liquidity to ' + n + "'s main pool on " + ch + ' and hold.';
    if (/bridge/.test(c)) return 'Bridge $' + cap + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.';
    if (/staking|restak/.test(c)) return "Stake $" + cap + " of the chain's staking asset through " + n + ' and keep the receipt.';
    if (/perpetual|derivative/.test(c)) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedge.';
    if (/prediction/.test(c)) return 'Fund $' + cap + ' and place one market position on ' + n + '.';
    if (/curator|allocator/.test(c)) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + ch + ' and keep the shares.';
    if (/stable/.test(c)) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + ch + '.';
    if (/rwa/.test(c)) return 'Mint $' + cap + " of the protocol's yield asset on " + ch + ' and hold it.';
    if (/insurance/.test(c)) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.';
    if (/chain/.test(c)) return 'Use ' + n + ' on ' + ch + ': bridge $' + cap + ' of USDC in and make one transaction a week in its app.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + ch + ' and keep the position open.';
  };
  /* Dated farm timeline, day 0 -> day N. */
  M.timeline = function (r, f) {
    var ch = r.chains && r.chains.length ? r.chains[0] : 'its main chain';
    var bePct = f.be >= 100 ? 'over 100' : (f.be * 100).toFixed(1);
    return [
      { when: 'day 0', s: 'Use a fresh wallet holding only the farm funds; keep its seed offline.', c: 'under $3 gas', t: '5 min' },
      { when: 'day 0', s: M.action(r, f.cap, ch), c: '$' + f.cap + ' capital, about $' + (f.cap >= 150 ? 8 : 4) + ' gas', t: '15 min' },
      { when: 'weekly x' + f.wk, s: 'Make one qualifying action a week (deposit, borrow, swap or vote).', c: 'about $2 gas a week', t: '10 min a week' },
      { when: 'day 21', s: 'Midway: re-read the rewards page; the snapshot records no token and no points program for ' + r.name + ', so farm the usage, not a promised airdrop. On $1,000 the slice would be $' + f.slice2 + ' if 10% of a launch went to depositors, against $' + f.cost2 + ' of costs, so it breaks even only if the launch chance is above ' + bePct + '% - verdict: ' + f.verdict + '.', c: 'no fee to check, and never pay to claim', t: '10 min' },
      { when: 'day ' + f.hold, s: 'Hold the position for at least ' + f.hold + ' days so the activity is counted in more than one snapshot.', c: 'the $' + f.cap + ' stays in the position', t: f.hold + ' days' },
      { when: 'day ' + f.hold, s: 'Claim only from the link the protocol itself publishes, then withdraw; write the wallet, the dates and every transaction in a farm log.', c: 'gas to withdraw', t: '15 min' }
    ];
  };
  /* "How $X is built" factor rows. */
  M.factors = function (r) {
    if (r.base_curve_value_usd != null) return [
      ['Size curve', '10^(a + b x log10 TVL/$100M)', r.base_curve_value_usd],
      ['Family', 'x ' + r.category_multiple.toFixed(4) + ' (' + r.comparables_n + ' live)', null],
      ['7-day growth', 'x ' + r.growth_multiplier.toFixed(4), null],
      ['Seasoning', 'x ' + r.maturity_multiplier.toFixed(4), null],
      ['Sibling', 'x 1.00 - tested, dropped', null],
      ['Implied value', '= implied value', r.implied_value_usd]
    ];
    var v = M.v1(r, { growth_floor: -50, growth_cap: 100, growth_weight: 0.35, maturity_floor: 0.65, maturity_range: 0.35, maturity_days: 1095, unknown_age_days: 365 });
    return [
      ['Size x family', 'TVL x ' + r.category_multiple.toFixed(3) + 'x', Math.round(r.tvl_usd * r.category_multiple)],
      ['7-day growth', 'x ' + v.growthMult.toFixed(4), null],
      ['Seasoning', 'x ' + v.maturity.toFixed(4), null],
      ['Implied value', '= implied value', v.implied]
    ];
  };
  g.RADAR_MODEL = M;
  if (typeof module !== 'undefined') module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
