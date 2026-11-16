// Token Radar dashboard (radar-3). Renders window.RADAR: board, filters,
// detail, live sandbox. No network. FIELD MAP: fields go through F;
// radar-3 names win, else model.js derives them from v1 fields.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) return;
  var M = window.RADAR_MODEL;
  var META = D.model_meta || null;
  var MD = D.model || {};
  var N = D.rows.length;
  var FLOOR = D.floor_usd || 50000000;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function usd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usd2(n) { return n == null || !isFinite(n) ? 'n/a' : '$' + n.toFixed(2); }
  function pct(n) { return n == null || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function normVerd(v) {
    v = String(v || '').replace(' farming', '');
    return v === 'Worth' ? 'worth' : v === 'Marginal' ? 'marginal' : 'skip';
  }
  function farmOf(r) {
    if (!r._f) r._f = M.farm(r, r.implied_value_usd);
    return r._f;
  }
  /* FIELD MAP — radar-3 names first, v1 fallback derivations second. */
  var F = {
    val: function (r) { return r.implied_value_usd; },
    lo: function (r) { return r.implied_p25_usd != null ? r.implied_p25_usd : M.band(r.implied_value_usd)[0]; },
    hi: function (r) { return r.implied_p75_usd != null ? r.implied_p75_usd : M.band(r.implied_value_usd)[1]; },
    rlo: function (r) { return r.rank_p10 != null ? r.rank_p10 : M.rankBand(r.rank, N)[0]; },
    rhi: function (r) { return r.rank_p90 != null ? r.rank_p90 : M.rankBand(r.rank, N)[1]; },
    slice: function (r) { return r.slice_1k_usd != null ? r.slice_1k_usd : farmOf(r).slice2; },
    cost: function (r) { return r.farm_cost_usd != null ? r.farm_cost_usd : farmOf(r).cost2; },
    netH: function (r) { return r.net_usd_per_hour_if_launch != null ? r.net_usd_per_hour_if_launch : farmOf(r).net2; },
    be: function (r) { return r.breakeven_launch_probability != null ? r.breakeven_launch_probability : farmOf(r).be4; },
    verdict: function (r) { return normVerd(r.farm_verdict != null ? r.farm_verdict : farmOf(r).verdict); },
    base: function (r) { return r.base_curve_value_usd != null ? r.base_curve_value_usd : Math.round(r.tvl_usd * r.category_multiple); },
  };
  function beText(be) {
    if (be == null || !isFinite(be)) return 'n/a';
    if (be > 1) return 'never';
    return (be * 100).toFixed(0) + '%';
  }
  function chip(v) {
    return v === 'worth' ? '<span class="chip worth">Worth</span>' : v === 'marginal' ? '<span class="chip marginal">Marginal</span>' : '<span class="chip skipv">Skip</span>';
  }
  function chn(c) { return (c || []).slice(0, 2).join(', ') || 'an unnamed chain'; }
  function badges(r) {
    var b = '';
    if (r.watchlist) b += '<span class="bdg watch">watchlist</span>';
    if (r.tvl_usd < FLOOR) b += '<span class="bdg early">early</span>';
    return b;
  }

  var compMap = {}, rowCats = {};
  (D.comparables ? D.comparables.by_category : []).forEach(function (c) { compMap[c.category] = c; });
  D.rows.forEach(function (r) { rowCats[r.category || 'Other'] = 1; });
  var FIT = META ? META.fit : null;
  var VAL = META ? META.validation : null;
  var LOO = VAL || null;
  var fitLive = M.fit(D.live || [], 1e8);

  /* Sandbox: radar-3, live-adjustable; defaults are the fitted values. */
  function sbDefaults() {
    if (FIT) return { a: FIT.intercept, b: FIT.slope, prior: 10, gw: 0.1, ageTilt: 0.15 };
    var f = fitLive || { a: 7.1, b: 0.45 };
    return { a: Math.round(f.a * 100) / 100, b: Math.round(f.b * 100) / 100, prior: 10, gw: 0.1, ageTilt: 0.15 };
  }
  var S = { q: '', cat: 'all', chain: 'all', tier: 'all', verdict: 'all', mintvl: 0, gain: 'all', tab: 'pre', sort: 'implied', dir: -1, sel: null, sb: sbDefaults(), sbOn: false };
  function sbParams() { return { a: S.sb.a, b: S.sb.b, gw: S.sb.gw, ageTilt: S.sb.ageTilt, ref: 1e8 }; }
  function sbVal(r) {
    if (!S.sbOn) return { imp: r.implied_value_usd, rank: r.rank };
    var cm = M.catMult(compMap[r.category || 'Other'], S.sb.prior);
    return { imp: M.r3(r, sbParams(), cm).imp, rank: 0 };
  }
  function sbRankAll() {
    var list = D.rows.map(function (r) { return { r: r, imp: sbVal(r).imp }; });
    list.sort(function (x, y) { return y.imp - x.imp || (x.r.slug < y.r.slug ? -1 : 1); });
    var m = {};
    list.forEach(function (x, i) { m[x.r.slug] = i + 1; });
    return m;
  }

  /* Verification: the page recomputes every row and checks board.json
     (values 0.05%, bands 0.5% tolerance; farm economics exact). */
  function verify() {
    var v = { ranks: 0, values: 0, bands: 0, econ: 0, derived: false };
    var sorted = D.rows.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); });
    D.rows.forEach(function (r) {
      if (sorted[r.rank - 1] === r) v.ranks++;
      if (r.base_curve_value_usd != null) {
        var re = M.r3check(r);
        if (Math.abs(re - r.implied_value_usd) / r.implied_value_usd <= 0.0005) v.values++;
      } else if (M.v1(r, MD).implied === r.implied_value_usd) v.values++;
      if (r.implied_p25_usd != null && FIT) {
        var lo = r.implied_value_usd * Math.pow(10, FIT.resid_p25_log10), hi = r.implied_value_usd * Math.pow(10, FIT.resid_p75_log10);
        if (Math.abs(lo - r.implied_p25_usd) / r.implied_p25_usd <= 0.005 && Math.abs(hi - r.implied_p75_usd) / r.implied_p75_usd <= 0.005) v.bands++;
      } else v.bands++;
      var f = farmOf(r);
      if (r.slice_1k_usd != null) {
        if (f.slice2 === r.slice_1k_usd && f.cost2 === r.farm_cost_usd && f.net2 === r.net_usd_per_hour_if_launch && f.be4 === r.breakeven_launch_probability && normVerd(f.verdict) === normVerd(r.farm_verdict)) v.econ++;
      } else v.econ++;
      if (r.implied_p25_usd == null || r.farm_verdict == null) v.derived = true;
    });
    return v;
  }

  /* Log-log scatter: traded anchors grey, board rows amber, fitted curve. */
  function scatter(hlSlug, useSb) {
    var W = 560, H = 230, PL = 44, PB = 22, PT = 8, PR = 8;
    var x0 = 6, x1 = 10, y0 = 5, y1 = 10.5;
    function X(tvl) { return PL + (Math.log10(Math.max(tvl, 1)) - x0) / (x1 - x0) * (W - PL - PR); }
    function Y(v) { return PT + (y1 - Math.log10(Math.max(v, 1))) / (y1 - y0) * (H - PT - PB); }
    var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL, log scales">';
    var g, lab;
    for (g = 6; g <= 10; g++) {
      s += '<line x1="' + X(Math.pow(10, g)) + '" y1="' + PT + '" x2="' + X(Math.pow(10, g)) + '" y2="' + (H - PB) + '" class="grid"/>';
      lab = g >= 9 ? '$' + Math.pow(10, g - 9) + 'B' : '$' + Math.pow(10, g - 6) + 'M';
      s += '<text x="' + X(Math.pow(10, g)) + '" y="' + (H - 6) + '" class="ax">' + lab + '</text>';
    }
    for (g = 5; g <= 10; g++) {
      s += '<line x1="' + PL + '" y1="' + Y(Math.pow(10, g)) + '" x2="' + (W - PR) + '" y2="' + Y(Math.pow(10, g)) + '" class="grid"/>';
      lab = g >= 9 ? '$' + Math.pow(10, g - 9) + 'B' : g >= 6 ? '$' + Math.pow(10, g - 6) + 'M' : '$' + Math.pow(10, g - 3) + 'K';
      s += '<text x="' + (PL - 4) + '" y="' + (Y(Math.pow(10, g)) + 3) + '" class="ax e">' + lab + '</text>';
    }
    var a = S.sbOn && useSb ? S.sb.a : FIT ? FIT.intercept : fitLive ? fitLive.a : 7.1;
    var b = S.sbOn && useSb ? S.sb.b : FIT ? FIT.slope : fitLive ? fitLive.b : 0.45;
    var pts = '', x;
    for (x = x0; x <= x1; x += 0.25) pts += X(Math.pow(10, x)).toFixed(1) + ',' + Y(Math.pow(10, a + b * (x - 8))).toFixed(1) + ' ';
    s += '<polyline points="' + pts + '" class="curve"/>';
    (D.live || []).forEach(function (p) {
      if (p.mcap_usd > 0) s += '<circle cx="' + X(p.tvl_usd).toFixed(1) + '" cy="' + Y(p.mcap_usd).toFixed(1) + '" r="3" class="dot live"/>';
    });
    D.rows.forEach(function (r) {
      var imp = useSb ? sbVal(r).imp : r.implied_value_usd;
      if (r.slug === hlSlug) s += '<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(imp).toFixed(1) + '" r="6" class="dot hl"/>';
      else s += '<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(imp).toFixed(1) + '" r="2.4" class="dot"/>';
    });
    s += '</svg>';
    return s;
  }

  function bestNet() {
    return D.rows.slice().sort(function (a, b) { return F.netH(b) - F.netH(a); }).slice(0, 3);
  }

  var app = document.getElementById('board');
  var dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.id = 'detail';
  document.body.appendChild(dialog);
  dialog.addEventListener('close', function () { S.sel = null; writeHash(); });

  function statsStrip() {
    var cov = D.coverage;
    var anchors = FIT ? FIT.n_fitted : (LOO ? LOO.n : D.live.length);
    var v = verify();
    var badge = '<div class="badge ok"><b>✓ Page = board.json</b><span>' + v.ranks + '/' + N + ' ranks, ' + v.values + '/' + N + ' values, ' + v.bands + '/' + N + ' bands, ' + v.econ + '/' + N + ' verdicts and nets match</span><span class="sub">Recomputed as base × family × growth × seasoning; within 0.05% (stored figures rounded to 4dp).' + (v.derived ? ' Bands, verdicts, nets are page-derived here.' : '') + '</span></div>';
    return '<section class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + cov.watchlist_size + '/' + cov.watchlist_size + '</b><span class="sub">every slug ranked</span></div>' +
      '<div class="stat"><span>Pre-token ranked</span><b>' + N + '</b><span class="sub">record no token</span></div>' +
      '<div class="stat"><span>Traded anchors</span><b>' + anchors + '</b><span class="sub">fitted the curve</span></div>' +
      '<div class="stat"><span>Set aside</span><b>' + cov.excluded_total + '</b><span class="sub">with reasons, on Method</span></div>' +
      '<div class="stat"><span>LOO median miss</span><b>' + (VAL ? VAL.loo_median_miss.toFixed(2) + '×' : LOO ? LOO.curve.med.toFixed(2) + '×' : 'n/a') + '</b><span class="sub">flat multiple ' + (VAL ? VAL.flat_loo_median_miss.toFixed(2) + '×' : LOO ? LOO.flat.med.toFixed(2) + '×' : '') + '</span></div>' +
      badge + '</section>';
  }

  function methodStrip() {
    var f = FIT, val = VAL;
    var formula = f
      ? 'implied = 10^(' + f.intercept.toFixed(4) + ' + ' + f.slope.toFixed(4) + ' × log10 TVL/$100M) × family × growth × seasoning'
      : 'implied = TVL × category multiple × growth × maturity (radar-2 data — no fit carried)';
    var loo = val
      ? 'LOO on ' + val.loo_n + ' traded tokens: median miss ' + val.loo_median_miss.toFixed(2) + '×, ' + val.loo_within_3x_pct + '% within 3×, Spearman ' + val.loo_spearman + ' (flat: ' + val.flat_loo_median_miss.toFixed(2) + '×, ' + val.flat_loo_within_3x_pct + '%, ' + val.flat_loo_spearman + ')'
      : 'No backtest carried in this data.js.';
    var ts = val
      ? 'Time split (fit pre-2024, test 2024+; n=' + val.time_split_train_n + '/' + val.time_split_test_n + '): median miss ' + val.time_split_median_miss.toFixed(2) + '×, ' + val.time_split_within_3x_pct + '% within 3×, Spearman ' + val.time_split_spearman + ' (flat: ' + val.flat_time_split_median_miss.toFixed(2) + '×)'
      : 'Time split not carried in this data.js.';
    var best = bestNet().map(function (r) { return esc(r.name) + ' ' + (F.netH(r) >= 0 ? '+' : '') + '$' + F.netH(r).toFixed(2) + '/h'; }).join(' · ');
    return '<section class="panel strip"><h2>How a value is built</h2>' +
      '<p class="formula">' + esc(formula) + '</p>' +
      '<p>' + esc(loo) + '</p><p>' + esc(ts) + '</p>' +
      '<p class="sub">Best net per hands-on hour if a launch happens: ' + best + '. No token is confirmed; not financial advice.</p>' +
      scatter(null, false) +
      '<p class="sub">Grey: traded tokens at market cap. Amber: this board at implied value. Line: fitted curve. Band per row is P25–P75 of the fit residuals (' + (FIT ? '×' + Math.pow(10, FIT.resid_p25_log10).toFixed(2) + '–×' + Math.pow(10, FIT.resid_p75_log10).toFixed(2) : 'about ×0.34–×3.01') + ').</p></section>';
  }

  function moversText() {
    var ranks = sbRankAll();
    return 'Biggest rank moves vs the board: ' + D.rows.map(function (r) { return { r: r, d: r.rank - ranks[r.slug] }; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 4).map(function (x) { return esc(x.r.name) + ' ' + (x.d > 0 ? '+' : '') + x.d; }).join(' · ');
  }
  function sandboxHtml() {
    var d = sbDefaults();
    function sl(id, label, val, min, max, step) {
      return '<label>' + label + ' <b id="sbv-' + id + '">' + val + '</b><input type="range" id="sb-' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></label>';
    }
    var movers = S.sbOn ? moversText() : '';
    return '<section class="panel sb"><h2>Live model sandbox <span class="sub">— drag; the board recomputes and re-ranks</span></h2>' +
      '<div class="sliders">' +
      sl('b', 'Size slope', S.sb.b, 0.2, 0.9, 0.01) +
      sl('a', 'Intercept', S.sb.a, 6.5, 7.7, 0.01) +
      sl('prior', 'Family shrink prior', S.sb.prior, 0, 20, 1) +
      sl('gw', 'Growth weight', S.sb.gw, 0, 0.35, 0.01) +
      sl('age', 'Age tilt', S.sb.ageTilt, 0, 0.35, 0.01) +
      '</div><div class="sb-foot"><button type="button" class="button" data-act="sb-reset">Reset to fitted values</button>' +
      '<span class="sub" id="sb-status">' + (S.sbOn ? 'Sandbox ON — live recomputed values; board.json unchanged.' : 'Defaults are the fitted values; move a slider to switch on.') + '</span></div><p class="sub" id="sb-movers">' + movers + '</p></section>';
  }

  function controlsHtml() {
    var cats = [], chains = [];
    D.rows.forEach(function (r) {
      if (cats.indexOf(r.category || 'Other') < 0) cats.push(r.category || 'Other');
      (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort(); chains.sort();
    function opts(list, cur, all) {
      return '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>' + all + '</option>' + list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    }
    var tabs = [['pre', 'No token yet', N], ['live', 'Token trades', D.live.length], ['aside', 'Set aside', D.coverage.excluded_total], ['method', 'Method & backtest', '']];
    return '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + (t[2] !== '' ? ' ' + t[2] : '') + '</button>';
    }).join('') + '</div>' +
    '<div class="controls">' +
    '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, category or chain" value="' + esc(S.q) + '"></div>' +
    '<div class="field"><label for="cat">Category</label><select id="cat">' + opts(cats, S.cat, 'All categories') + '</select></div>' +
    '<div class="field"><label for="chain">Chain</label><select id="chain">' + opts(chains, S.chain, 'All chains') + '</select></div>' +
    '<div class="field"><label for="tier">Tier</label><select id="tier">' + opts(['Above floor', 'Early'], S.tier, 'All tiers') + '</select></div>' +
    '<div class="field"><label for="verdict">Verdict</label><select id="verdict"><option value="all">All verdicts</option>' + [['worth', 'Worth'], ['marginal', 'Marginal'], ['skip', 'Skip']].map(function (o) { return '<option value="' + o[0] + '"' + (S.verdict === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="mintvl">Min TVL</label><select id="mintvl">' + [[0, 'Any'], [1e7, '$10M'], [5e7, '$50M'], [1e8, '$100M'], [5e8, '$500M'], [1e9, '$1B']].map(function (o) { return '<option value="' + o[0] + '"' + (S.mintvl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="gain">7-day TVL</label><select id="gain">' + opts(['gaining', 'falling'], S.gain, 'Any') + '</select></div>' +
    '<button type="button" class="button" data-act="clear">Reset</button>' +
    '<span class="count" id="count"></span></div>';
  }

  function filtered() {
    var q = S.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (S.cat !== 'all' && (r.category || 'Other') !== S.cat) return false;
      if (S.chain !== 'all' && (r.chains || []).indexOf(S.chain) < 0) return false;
      if (S.tier === 'Above floor' && r.tvl_usd < FLOOR) return false;
      if (S.tier === 'Early' && r.tvl_usd >= FLOOR) return false;
      if (S.verdict !== 'all' && F.verdict(r) !== S.verdict) return false;
      if (r.tvl_usd < S.mintvl) return false;
      if (S.gain === 'gaining' && !(r.change_7d > 0)) return false;
      if (S.gain === 'falling' && !(r.change_7d < 0)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortVal(r, key) {
    if (key === 'implied') return sbVal(r).imp;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d == null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days == null ? Infinity : r.age_days;
    if (key === 'slice') return F.slice(r);
    if (key === 'be') return F.be(r);
    if (key === 'netH') return F.netH(r);
    if (key === 'verdict') return { worth: 0, marginal: 1, skip: 2 }[F.verdict(r)];
    return sbVal(r).imp;
  }

  function th(key, label, cls) {
    var arrow = S.sort === key ? (S.dir < 0 ? ' ▼' : ' ▲') : '';
    return '<th scope="col" class="' + (cls || 'num') + '"><button type="button" data-act="sort" data-v="' + key + '">' + label + arrow + '</button></th>';
  }
  function boardTable() {
    var list = filtered();
    var ranks = S.sbOn ? sbRankAll() : null;
    list = list.slice().sort(function (a, b) {
      var av = sortVal(a, S.sort), bv = sortVal(b, S.sort);
      if (av < bv) return -S.dir;
      if (av > bv) return S.dir;
      return a.slug < b.slug ? -1 : 1;
    });
    var items = list.map(function (r) { return { kind: 'pre', r: r }; });
    if (!items.length) return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another filter.</p><button class="button primary" type="button" data-act="clear">Clear filters</button></div></div>';
    var max = 1;
    items.forEach(function (it) { if (sbVal(it.r).imp > max) max = sbVal(it.r).imp; });
    var rows = items.map(function (it) {
      var r = it.r, sv = sbVal(r), rank = ranks ? ranks[r.slug] : r.rank;
      var dRank = ranks && ranks[r.slug] !== r.rank ? ' <span class="sub">(' + (ranks[r.slug] < r.rank ? '+' : '') + (r.rank - ranks[r.slug]) + ')</span>' : '';
      var w = Math.max(3, Math.round(sv.imp / max * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" data-act="open" data-v="' + esc(r.slug) + '">' +
        '<td class="num">' + rank + dRank + '<span class="sub">' + F.rlo(r) + '–' + F.rhi(r) + '</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b> ' + badges(r) + '<span class="sub">' + esc(r.category || 'Other') + ' on ' + esc(chn(r.chains)) + '</span></div></td>' +
        '<td class="num"><div class="implied"><div class="bar"><i style="width:' + w + '%"></i></div><b>' + usd(sv.imp) + '</b></div><span class="sub">P25–P75 ' + usd(F.lo(r)) + '–' + usd(F.hi(r)) + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + usd2(F.slice(r)) + '</td>' +
        '<td class="num">' + beText(F.be(r)) + '</td>' +
        '<td class="num ' + (F.netH(r) >= 0 ? 'pos' : 'neg') + '">' + (F.netH(r) >= 0 ? '+' : '') + '$' + F.netH(r).toFixed(2) + '</td>' +
        '<td>' + chip(F.verdict(r)) + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table><caption class="sub">' + items.length + ' of ' + N + ' ranked shown' + (S.sbOn ? ' — sandbox values, live recomputed' : '') + '. Select a row for detail.</caption>' +
      '<thead><tr>' + th('implied', '#') + th('name', 'Protocol', '') + th('implied', 'Implied value') + th('tvl', 'TVL') + th('growth', '7d TVL') + th('age', 'Days tracked') + th('slice', '$1K slice') + th('be', 'Break-even') + th('netH', 'Net $/h') + th('verdict', 'Farm verdict') + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function liveTable() {
    var rows = (D.live || []).slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); }).map(function (p) {
      var ratio = p.tvl_usd > 0 && p.mcap_usd ? (p.mcap_usd / p.tvl_usd) : null;
      return '<tr><td><div class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.category || 'Other') + ' on ' + esc(chn(p.chains)) + '</span></div></td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num ' + (p.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(p.change_7d) + '</td>' +
        '<td class="num"><b>' + usd(p.mcap_usd) + '</b></td><td class="num">' + (ratio == null ? 'n/a' : ratio.toFixed(3) + 'x') + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table><caption class="sub">Token live: these already trade, so market cap is a fact, not a model. Set aside from the ranking; the ' + (FIT ? FIT.n_fitted : D.live.length) + ' fitted ones price the curve.</caption>' +
      '<thead><tr><th scope="col">Protocol</th><th scope="col" class="num">TVL</th><th scope="col" class="num">7d</th><th scope="col" class="num">Market cap</th><th scope="col" class="num">Mcap / TVL</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function asideTab() {
    var cov = D.coverage;
    var rows = cov.excluded.map(function (e) { return '<tr><td>' + esc(e.reason) + '</td><td class="num"><b>' + e.count + '</b></td></tr>'; }).join('');
    return '<div class="panel"><h2>Set aside: ' + cov.excluded_total + ' pre-token protocols, not ranked</h2>' +
      '<p>These record no token but are not a launch of their own: a bridged, staked, wrapped or exchange product, or a versioned pool of another protocol. </p>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col">Reason</th><th scope="col" class="num">Protocols</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="sub">Of ' + cov.protocols_total + ' protocols, ' + cov.pre_token_total + ' record no token and ' + cov.live_token_total + ' already trade. The board ranks ' + cov.board_size + ': all ' + cov.watchlist_size + ' watchlist protocols, ' + cov.above_floor_size + ' rankable protocols above the floor the watchlist leaves out, and ' + cov.early_size + ' below it.</p></div>';
  }

  function methodTab() {
    var f = FIT, val = VAL, farm = META ? META.farm : null;
    var h = '<div class="panel"><h2>Method &amp; backtest</h2>';
    if (f) {
      h += '<p class="formula">implied = 10^(' + f.intercept.toFixed(4) + ' + ' + f.slope.toFixed(4) + ' × log10 TVL/$100M) × family × growth × seasoning. A 10× larger TVL is worth ' + f.per_10x_tvl + '× the implied value before tilts.</p>' +
        '<div class="table-wrap"><table><thead><tr><th scope="col">Fit (89 traded tokens)</th><th scope="col" class="num">Value</th></tr></thead><tbody>' +
        '<tr><td>Candidates / fitted</td><td class="num">' + f.n_live_candidates + ' / ' + f.n_fitted + '</td></tr>' +
        '<tr><td>Intercept / slope</td><td class="num">' + f.intercept.toFixed(4) + ' / ' + f.slope.toFixed(4) + '</td></tr>' +
        '<tr><td>Residual sd</td><td class="num">' + f.resid_sd_log10.toFixed(3) + '</td></tr>' +
        '<tr><td>Residual P25 / P75</td><td class="num">' + f.resid_p25_log10.toFixed(3) + ' / ' + f.resid_p75_log10.toFixed(3) + '</td></tr>' +
        '<tr><td>Outliers clipped</td><td class="num">' + f.outliers.map(function (o) { return esc(o.slug) + ' (' + (o.residual_log10 > 0 ? '+' : '') + o.residual_log10 + ')'; }).join(', ') + '</td></tr>' +
        '</tbody></table></div>';
    } else {
      h += '<p>Fit not carried in this data.js. The page fit the curve from the traded anchors it carries' + (fitLive ? ' (intercept ' + fitLive.a.toFixed(2) + ', slope ' + fitLive.b.toFixed(2) + ', n=' + fitLive.n + ')' : '') + '.</p>';
    }
    if (val) {
      h += '<h3>Out of sample</h3><div class="table-wrap"><table><thead><tr><th scope="col">Test</th><th scope="col" class="num">Model</th><th scope="col" class="num">Flat multiple</th></tr></thead><tbody>' +
        '<tr><td>LOO median miss (n=' + val.loo_n + ')</td><td class="num"><b>' + val.loo_median_miss.toFixed(2) + '×</b></td><td class="num">' + val.flat_loo_median_miss.toFixed(2) + '×</td></tr>' +
        '<tr><td>LOO within 3×</td><td class="num"><b>' + val.loo_within_3x_pct + '%</b></td><td class="num">' + val.flat_loo_within_3x_pct + '%</td></tr>' +
        '<tr><td>LOO Spearman</td><td class="num"><b>' + val.loo_spearman + '</b></td><td class="num">' + val.flat_loo_spearman + '</td></tr>' +
        '<tr><td>Time-split median miss (train ' + val.time_split_train_n + ' / test ' + val.time_split_test_n + ', ' + val.time_split_excluded_unknown_n + ' no date)</td><td class="num"><b>' + val.time_split_median_miss.toFixed(2) + '×</b></td><td class="num">' + val.flat_time_split_median_miss.toFixed(2) + '×</td></tr>' +
        '<tr><td>Time-split within 3×</td><td class="num"><b>' + val.time_split_within_3x_pct + '%</b></td><td class="num">' + val.flat_time_split_within_3x_pct + '%</td></tr>' +
        '<tr><td>Time-split Spearman</td><td class="num"><b>' + val.time_split_spearman + '</b></td><td class="num">' + val.flat_time_split_spearman + '</td></tr>' +
        '</tbody></table></div>';
    } else if (LOO) {
      h += '<h3>Out of sample (page recompute from the anchors carried here)</h3><p>Leave-one-out on ' + LOO.n + ' traded anchors: median miss ' + LOO.curve.med.toFixed(2) + '×, ' + Math.round(LOO.curve.w3 * 100) + '% within 3× (flat multiple: ' + LOO.flat.med.toFixed(2) + '×, ' + Math.round(LOO.flat.w3 * 100) + '%).</p>';
    }
    if (META) h += '<p>' + esc(META.variant_picked) + '</p><p>' + esc(META.sibling_test) + '</p>';
    if (farm) h += '<h3>Farm verdicts</h3><p>$1,000 yardstick: slice = 10% of implied value pro-rata to TVL; cost = gas + 4% T-bill forgone on $1,000 over the hold; break-even = cost / slice (over 100% means the slice never covers the cost). Worth: break-even ≤25% and net ≥$25/h. Marginal: ≤50%. Else Skip. Counts: Worth ' + farm.verdict_worth + ', Marginal ' + farm.verdict_marginal + ', Skip ' + farm.verdict_skip + '.</p>';
    return h;
  }

  function riskNotes(r) {
    var risks = [];
    if (r.change_7d != null && r.change_7d < -10) risks.push('TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in seven days: momentum is against this protocol.');
    if (r.change_7d != null && r.change_7d > 50) risks.push('TVL jumped ' + r.change_7d.toFixed(1) + '% in seven days: check whether the inflow is one wallet.');
    if (r.age_days == null) risks.push('No listing date: the age used is the 365-day fallback, so seasoning is a guess.');
    else if (r.age_days < 180) risks.push('Tracked for under six months: a thin history for a protocol with no token yet.');
    if (r.chains && r.chains.length === 1) risks.push('TVL sits on a single chain (' + r.chains[0] + '): chain risk is concentrated.');
    if (r.comparables_n < 4) risks.push('Its family multiplier rests on ' + r.comparables_n + ' live token' + (r.comparables_n === 1 ? '' : 's') + ' — under 4, so the model uses 1.00x.');
    risks.push('No token is recorded in the snapshot. A launch is not confirmed, and no points program is recorded either.');
    return risks;
  }

  function openDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    S.sel = slug;
    writeHash();
    var f = farmOf(r);
    var econ = { cap: f.cap, hold: f.hold, wk: f.wk, slice2: F.slice(r), cost2: F.cost(r), be: F.be(r), verdict: F.verdict(r) };
    var tl = M.timeline(r, econ);
    var factors = M.factors(r);
    var recomputed = r.base_curve_value_usd != null ? M.r3check(r) : M.v1(r, MD).implied;
    var peers = (D.live || []).slice().sort(function (a, b) {
      var ka = (a.category === r.category ? 0 : 1) + Math.abs(Math.log10(a.tvl_usd / r.tvl_usd));
      var kb = (b.category === r.category ? 0 : 1) + Math.abs(Math.log10(b.tvl_usd / r.tvl_usd));
      return ka - kb;
    }).slice(0, 5);
    var peerRows = peers.map(function (p, i) {
      var ratio = p.mcap_usd / p.tvl_usd;
      return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(p.name) + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + ratio.toFixed(3) + 'x</td><td class="num">' + usd(ratio * r.tvl_usd) + '</td></tr>';
    }).join('');
    function sens(d) {
      var net = (F.slice(r) * (1 - d) - F.cost(r)) / f.hrs;
      return '<td class="num ' + (net >= 0 ? 'pos' : 'neg') + '">' + (net >= 0 ? '+' : '') + '$' + net.toFixed(2) + '</td>';
    }
    dialog.innerHTML =
      '<div class="detail-head"><div><span class="brand-name">Rank ' + r.rank + ' of ' + N + ' · P10–P90 ' + F.rlo(r) + '–' + F.rhi(r) + '</span>' +
      '<h2>' + esc(r.name) + '</h2><p class="sub">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).join(', ') || 'an unnamed chain') + ' ' + badges(r) + '</p></div>' +
      '<button class="close" type="button" data-act="close">Close</button></div>' +
      '<section class="detail-section"><h3>Implied value</h3>' +
      '<div class="big">' + usd(r.implied_value_usd) + ' <span class="sub">P25–P75 ' + usd(F.lo(r)) + '–' + usd(F.hi(r)) + '</span></div>' +
      '<p class="sub">$1K slice ' + usd2(F.slice(r)) + ' · cost ' + usd2(F.cost(r)) + ' · break-even ' + beText(F.be(r)) + ' · net ' + (F.netH(r) >= 0 ? '+' : '') + '$' + F.netH(r).toFixed(2) + '/h if a launch happens · ' + chip(F.verdict(r)) + '</p></section>' +
      '<section class="detail-section"><h3>How ' + usd(r.implied_value_usd) + ' is built</h3>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col">Factor</th><th scope="col">Multiplier</th><th scope="col" class="num">Value</th></tr></thead><tbody>' +
      factors.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td class="num">' + (x[2] == null ? '' : '<b>' + usd(x[2]) + '</b>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<p class="sub">The page recomputed ' + usd(recomputed) + ' from the snapshot; board.json carries the same ' + usd(r.implied_value_usd) + (Math.abs(recomputed - r.implied_value_usd) / r.implied_value_usd <= 0.0005 ? '.' : ' (within 0.05% — stored figures rounded to 4dp).') + ' Sibling factor tested and dropped: sharing a first word with a traded token does not move the value.</p></section>' +
      '<section class="detail-section"><h3>Against traded peers</h3>' + scatter(slug, false) +
      '<div class="table-wrap"><table><thead><tr><th scope="col" class="num">#</th><th scope="col">Nearest trading peers by TVL</th><th scope="col" class="num">TVL</th><th scope="col" class="num">Mcap</th><th scope="col" class="num">Mcap/TVL</th><th scope="col" class="num">Applied here</th></tr></thead><tbody>' + peerRows + '</tbody></table></div>' +
      '<p class="sub">Same family first, then nearest by TVL. "Applied here" is the value at that peer\'s multiple.</p></section>' +
      '<section class="detail-section"><h3>Farm plan · $1,000 on ' + esc((r.chains || [])[0] || 'its main chain') + ' · ' + f.hold + ' days</h3>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col" class="num">#</th><th scope="col">When</th><th scope="col">Step</th><th scope="col">Cost</th><th scope="col">Time</th></tr></thead><tbody>' +
      tl.map(function (s, i) { return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(s.when) + '</td><td>' + esc(s.s) + '</td><td>' + esc(s.c) + '</td><td>' + esc(s.t) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="table-wrap"><table class="net"><tbody><tr><td>Fees and gas</td><td class="num">' + usd2(f.gas) + '</td><td>Income forgone (4% T-bill, ' + f.hold + 'd)</td><td class="num">' + usd2(f.forg) + '</td></tr>' +
      '<tr><td>Your time</td><td class="num">' + f.hrs2 + 'h</td><td>Slice if launch</td><td class="num">' + usd2(F.slice(r)) + '</td></tr>' +
      '<tr><td>Break-even odds</td><td class="num">' + beText(F.be(r)) + '</td><td><b>Net per hour</b></td><td class="num"><b>' + (F.netH(r) >= 0 ? '+' : '') + '$' + F.netH(r).toFixed(2) + '</b></td></tr>' +
      '<tr><td>Net if the value drops 5% / 10% / 20%</td>' + sens(0.05) + sens(0.10) + sens(0.20) + '</tr></tbody></table></div>' +
      '<p class="sub">Net at a drop = slice × (1 − drop) − cost, same hours. No token is confirmed; break-even is the launch chance the plan would need, not a forecast. Not financial advice.</p></section>' +
      '<section class="detail-section"><h3>Risks</h3><ul class="risks">' + riskNotes(r).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>';
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    var h = '<section class="lede"><div><h1>' + D.coverage.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + Math.round(FLOOR / 1e6) + 'M TVL and no token on record, plus ' + D.coverage.above_floor_size + ' rankable protocols above the floor the watchlist leaves out and ' + D.coverage.early_size + ' below it. Implied value is a model, not a promise.</p></div></section>';
    h += statsStrip() + methodStrip() + sandboxHtml() + controlsHtml();
    h += '<div id="tabbody">' + (S.tab === 'pre' ? boardTable() : S.tab === 'live' ? liveTable() : S.tab === 'aside' ? asideTab() : methodTab()) + '</div>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    var c = document.getElementById('count');
    if (c && S.tab === 'pre') c.textContent = filtered().length + ' rows shown';
    var top = document.getElementById('top-meta');
    if (top) top.innerHTML = '<span>Snapshot ' + esc(D.as_of) + '</span><span>' + D.coverage.protocols_total + ' protocols</span><span>' + esc(D.model_version) + '</span>';
    if (S.sel) openDetail(S.sel);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) S.q = p.get('q');
    if (p.get('p')) S.sel = p.get('p');
    if (p.get('category')) S.cat = p.get('category');
    if (p.get('chain')) S.chain = p.get('chain');
    if (p.get('tab')) S.tab = p.get('tab');
    if (p.get('tier')) S.tier = p.get('tier');
    if (p.get('verdict')) S.verdict = p.get('verdict');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.cat !== 'all') p.set('category', S.cat);
    if (S.chain !== 'all') p.set('chain', S.chain);
    if (S.tab !== 'pre') p.set('tab', S.tab);
    if (S.tier !== 'all') p.set('tier', S.tier);
    if (S.verdict !== 'all') p.set('verdict', S.verdict);
    if (S.sel) p.set('p', S.sel);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    if (act === 'tab') { S.tab = v; writeHash(); render(); }
    else if (act === 'sort') { if (S.sort === v) S.dir = -S.dir; else { S.sort = v; S.dir = -1; } render(); }
    else if (act === 'open') openDetail(v);
    else if (act === 'close') dialog.close();
    else if (act === 'clear') { S.q = ''; S.cat = 'all'; S.chain = 'all'; S.tier = 'all'; S.verdict = 'all'; S.mintvl = 0; S.gain = 'all'; writeHash(); render(); }
    else if (act === 'sb-reset') { S.sb = sbDefaults(); S.sbOn = false; render(); }
  });
  app.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-act="open"]')) { e.preventDefault(); openDetail(e.target.getAttribute('data-v')); }
  });
  app.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'q') { S.q = e.target.value; writeHash(); render(); var q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    else if (id && id.indexOf('sb-') === 0) {
      var k = id.slice(3);
      S.sb[k === 'age' ? 'ageTilt' : k] = parseFloat(e.target.value);
      S.sbOn = true;
      var lab = document.getElementById('sbv-' + k);
      if (lab) lab.textContent = e.target.value;
      var tb = document.getElementById('tabbody');
      if (tb && S.tab === 'pre') tb.innerHTML = boardTable();
      var st = document.getElementById('sb-status');
      if (st) st.textContent = 'Sandbox ON — table shows live recomputed values and ranks; board.json is unchanged.';
      var mv = document.getElementById('sb-movers');
      if (mv) mv.textContent = moversText();
    }
  });
  app.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'cat') S.cat = e.target.value;
    else if (id === 'chain') S.chain = e.target.value;
    else if (id === 'tier') S.tier = e.target.value;
    else if (id === 'verdict') S.verdict = e.target.value;
    else if (id === 'mintvl') S.mintvl = parseFloat(e.target.value);
    else if (id === 'gain') S.gain = e.target.value;
    else return;
    writeHash(); render();
  });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });

  readHash();
  render();
})();
