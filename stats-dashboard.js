/* Panda Ledger – private stats dashboard. No data is embedded; everything is fetched after key entry. */
(function () {
  'use strict';
  var API = 'https://panda-partners-api.vercel.app/api/stats';
  var SS_KEY = 'panda_stats_key';
  var TZ = 'Europe/London';
  var UNKNOWN = 'Unknown';

  var S = {
    key: null, data: null, loading: false, error: null, loadedAt: null,
    tab: 'overview', timer: null, reqId: 0,
    f: { from: '', to: '', country: '', region: '', gender: '', verified: '', source: '', plan: '', billing: '', size: '' },
    t: {
      users: { q: '', sort: 'createdAt', dir: -1, page: 0, size: 25 },
      businesses: { q: '', sort: 'createdAt', dir: -1, page: 0, size: 25 },
      payments: { q: '', sort: 'paidAt', dir: -1, page: 0, size: 25 }
    }
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }
  function nf(n) { return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-GB'); }
  function pct(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '—'; }

  /* ---------- dates (Europe/London) ---------- */
  var dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var showFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
  var showDT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function parse(v) { if (blank(v)) return null; var d = new Date(v); return isNaN(d) ? null : d; }
  function dayKey(v) { var d = parse(v); return d ? dayFmt.format(d) : null; }
  function fmtDate(v) { var d = parse(v); return d ? showFmt.format(d) : ''; }
  function fmtDT(v) { var d = parse(v); return d ? showDT.format(d) : ''; }
  function todayKey() { return dayFmt.format(new Date()); }
  function addDays(key, n) { var d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function inRange(v) {
    if (!S.f.from && !S.f.to) return true;
    var k = dayKey(v); if (!k) return false;
    if (S.f.from && k < S.f.from) return false;
    if (S.f.to && k > S.f.to) return false;
    return true;
  }

  /* ---------- money ---------- */
  function minorDigits(cur) {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; }
  }
  function major(p) { if (p.amountPaidMinor == null || isNaN(p.amountPaidMinor)) return null; return Number(p.amountPaidMinor) / Math.pow(10, minorDigits(p.currency || 'GBP')); }
  function money(v, cur) {
    if (v == null) return '—';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(v); } catch (e) { return v.toFixed(2) + ' ' + cur; }
  }
  function curOf(p) { return blank(p.currency) ? UNKNOWN : String(p.currency).toUpperCase(); }

  /* ---------- normalisers ---------- */
  function lab(v) { return blank(v) ? UNKNOWN : String(v).trim(); }
  function genderLab(v) {
    if (blank(v)) return UNKNOWN;
    var s = String(v).trim().toLowerCase();
    if (s === 'unknown' || s === 'unspecified' || s === 'null' || s === 'n/a') return UNKNOWN;
    if (s === 'prefer not to say' || s === 'prefer_not_to_say') return 'Prefer not to say';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function countryLab(r) { return blank(r.country) ? (blank(r.countryCode) ? UNKNOWN : String(r.countryCode).toUpperCase()) : String(r.country).trim(); }
  function verifiedLab(u) { return u.identityVerified === true ? 'Verified' : u.identityVerified === false ? 'Unverified' : UNKNOWN; }
  function sizeLab(b) {
    var e = b.employeeCount;
    if (e == null || e === '' || isNaN(e)) return UNKNOWN;
    e = Number(e);
    if (e < 10) return '1–9 employees';
    if (e < 50) return '10–49 employees';
    if (e < 250) return '50–249 employees';
    return '250+ employees';
  }
  var SIZE_ORDER = ['1–9 employees', '10–49 employees', '50–249 employees', '250+ employees', UNKNOWN];
  function bizName(b) { return b.businessName || b.name || ''; }

  /* ---------- filtering ---------- */
  function geo(r) {
    if (S.f.country && countryLab(r) !== S.f.country) return false;
    if (S.f.region && lab(r.region) !== S.f.region) return false;
    return true;
  }
  function q(row, fields, term) {
    if (!term) return true;
    term = term.toLowerCase();
    for (var i = 0; i < fields.length; i++) { var v = row[fields[i]]; if (v != null && String(v).toLowerCase().indexOf(term) >= 0) return true; }
    return false;
  }
  function bizPass(b) {
    if (S.f.plan && lab(b.planTier) !== S.f.plan) return false;
    if (S.f.billing && lab(b.billingState) !== S.f.billing) return false;
    if (S.f.size && sizeLab(b) !== S.f.size) return false;
    return true;
  }
  function filtered(useSearch) {
    var d = S.data; if (!d) return { users: [], businesses: [], payments: [], activity: [] };
    var users = d.users.filter(function (u) {
      if (!inRange(u.createdAt) || !geo(u)) return false;
      if (S.f.gender && genderLab(u.gender) !== S.f.gender) return false;
      if (S.f.verified === 'yes' && u.identityVerified !== true) return false;
      if (S.f.verified === 'no' && u.identityVerified === true) return false;
      if (S.f.source && lab(u.source) !== S.f.source) return false;
      return !useSearch || q(u, ['name', 'email', 'uid', 'id'], S.t.users.q);
    });
    var bizIndex = {};
    d.businesses.forEach(function (b) { bizIndex[b.id] = b; });
    var businesses = d.businesses.filter(function (b) {
      if (!inRange(b.createdAt) || !geo(b) || !bizPass(b)) return false;
      return !useSearch || q(b, ['businessName', 'name', 'ownerName', 'ownerEmail', 'address', 'placeId'], S.t.businesses.q);
    });
    var bizFilterOn = S.f.plan || S.f.billing || S.f.size;
    var payments = (srcState('payments') === 'unavailable' ? [] : d.payments).filter(function (p) {
      if (!inRange(p.paidAt) || !geo(p)) return false;
      if (S.f.plan && lab(p.planTier) !== S.f.plan) return false;
      if (bizFilterOn && (S.f.billing || S.f.size)) { var b = bizIndex[p.businessId]; if (!b || !bizPass(b)) return false; }
      return !useSearch || q(p, ['businessName', 'customerId', 'subscriptionId', 'id'], S.t.payments.q);
    });
    var activity = d.activity.filter(function (a) { return inRange(a.ts) && geo(a); });
    return { users: users, businesses: businesses, payments: payments, activity: activity };
  }

  /* ---------- aggregation ---------- */
  function countBy(rows, fn) {
    var m = Object.create(null); rows.forEach(function (r) { var k = fn(r); m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { label: k, count: m[k] }; }).sort(function (a, b) { return (a.label === UNKNOWN) - (b.label === UNKNOWN) || b.count - a.count; });
  }
  function moneyByCurrency(pays) {
    var m = {};
    pays.forEach(function (p) { var c = curOf(p); var v = major(p); if (!m[c]) m[c] = { currency: c, total: 0, count: 0 }; if (v != null) m[c].total += v; m[c].count++; });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  }
  function dailySeries(rows, field) {
    var keys = rows.map(function (r) { return dayKey(r[field]); }).filter(Boolean);
    var from = S.f.from || (keys.length ? keys.reduce(function (a, b) { return a < b ? a : b; }) : null);
    var to = S.f.to || todayKey();
    if (!from) return [];
    var m = {}; keys.forEach(function (k) { m[k] = (m[k] || 0) + 1; });
    var out = [], k = from, guard = 0;
    while (k <= to && guard++ < 4000) { out.push({ key: k, v: m[k] || 0 }); k = addDays(k, 1); }
    if (out.length > 120) { // roll up to weeks (Mon start) for long ranges
      var w = {}, order = [];
      out.forEach(function (o) { var d = new Date(o.key + 'T12:00:00Z'); var dow = (d.getUTCDay() + 6) % 7; var wk = addDays(o.key, -dow); if (!(wk in w)) { w[wk] = 0; order.push(wk); } w[wk] += o.v; });
      out = order.map(function (wk) { return { key: wk, v: w[wk], week: true }; });
    }
    return out;
  }

  /* ---------- charts (native SVG) ---------- */
  function columnChart(series, label) {
    if (!series.length || !series.some(function (s) { return s.v > 0; })) return '<div class="empty">No ' + esc(label) + ' in the selected range.</div>';
    var W = 640, H = 200, pl = 34, pb = 22, pt = 8;
    var max = Math.max.apply(null, series.map(function (s) { return s.v; }));
    var step = niceStep(max); var top = Math.ceil(max / step) * step || 1;
    var bw = (W - pl) / series.length;
    var g = '';
    for (var t = 0; t <= top; t += step) { var y = pt + (H - pt - pb) * (1 - t / top); g += '<line x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#ddd5c6" stroke-width="1"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + t + '</text>'; }
    series.forEach(function (s, i) {
      var h = (H - pt - pb) * (s.v / top); var x = pl + i * bw + bw * 0.12;
      var tip = (s.week ? 'Week of ' : '') + showFmt.format(new Date(s.key + 'T12:00:00Z')) + ': ' + s.v + ' ' + label;
      g += '<rect class="hit" data-tip="' + esc(tip) + '" x="' + x.toFixed(1) + '" y="' + (H - pb - h).toFixed(1) + '" width="' + Math.max(1, bw * 0.76).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" fill="#2f3f73" rx="1.5"><title>' + esc(tip) + '</title></rect>';
    });
    var ticks = [0, Math.floor(series.length / 2), series.length - 1];
    ticks.forEach(function (i, n) { if (i < 0 || (n && i === ticks[n - 1])) return; var x = pl + i * bw + bw / 2; g += '<text x="' + x + '" y="' + (H - 5) + '" text-anchor="' + (n === 0 ? 'start' : n === 2 ? 'end' : 'middle') + '">' + esc(showFmt.format(new Date(series[i].key + 'T12:00:00Z'))) + '</text>'; });
    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + ' per ' + (series[0].week ? 'week' : 'day') + '">' + g + '</svg></div>';
  }
  function niceStep(max) { if (max <= 5) return 1; var raw = max / 4; var p = Math.pow(10, Math.floor(Math.log10(raw))); var n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function barList(items, opts) {
    opts = opts || {};
    if (!items.length) return '<div class="empty">' + esc(opts.empty || 'No records match the current filters.') + '</div>';
    var total = items.reduce(function (a, b) { return a + b.count; }, 0);
    var shown = items.slice(0, opts.limit || 8);
    var max = Math.max.apply(null, shown.map(function (x) { return x.count; })) || 1;
    var html = shown.map(function (x) {
      return '<div class="brow"><span class="l' + (x.label === UNKNOWN ? ' unk' : '') + '" title="' + esc(x.label) + '">' + esc(x.label) + '</span><span class="t"><i style="width:' + (x.count / max * 100).toFixed(1) + '%;--bar:' + (x.label === UNKNOWN ? '#b5ab99' : (opts.color || '#2f3f73')) + '"></i></span><span class="v">' + nf(x.count) + ' <span style="color:var(--mute)">' + pct(x.count, total) + '</span></span></div>';
    }).join('');
    if (items.length > shown.length) html += '<p class="sub" style="margin:4px 0 0">Top ' + shown.length + ' of ' + items.length + ' shown.</p>';
    return '<div class="bars">' + html + '</div>';
  }

  /* ---------- source completeness ---------- */
  var SRC_PAT = { users: /user|signup|sign-up|auth|account|consumer/i, businesses: /business|partner|venue|workspace/i, payments: /payment|stripe|invoice|billing/i, activity: /activity|event|open/i };
  function srcState(kind) {
    var srcs = ((S.data && S.data.dataQuality) || {}).sources || [];
    var rel = srcs.filter(function (s) { return SRC_PAT[kind].test(s.name || ''); });
    if (rel.some(function (s) {
      return s.read === false || s.available === false ||
        (s.read === 0 && s.complete === false) || s.status === 'unavailable';
    })) return 'unavailable';
    if (rel.some(function (s) { return s.complete === false; })) return 'partial';
    return 'ok';
  }
  function srcNote(kind) { var st = srcState(kind); return st === 'unavailable' ? 'Source not read: figure unavailable' : st === 'partial' ? 'Source incomplete: partial count, minimum only' : ''; }
  function gated(kind, n) { var st = srcState(kind); return st === 'unavailable' ? '<span class="na">Unavailable</span>' : st === 'partial' ? n + '<span class="tag o" style="margin-left:6px;font-size:11px;vertical-align:middle">partial</span>' : n; }

  /* ---------- status ---------- */
  function renderStatus() {
    var el = $('status'); var h = '';
    if (S.loading) h += '<span class="pill load">Loading…</span>';
    if (S.error) h += '<span class="pill bad">Refresh failed</span><span>' + esc(S.error) + (S.data ? ' Showing the last successful load below; figures may be stale.' : '') + '</span>';
    if (S.data) {
      var dq = S.data.dataQuality || {}; var srcs = dq.sources || []; var inc = srcs.filter(function (s) { return s.complete === false || s.read === false; });
      var warns = (dq.warnings || []).length;
      h += inc.length || warns ? '<span class="pill warn">' + (inc.length ? inc.length + ' incomplete source' + (inc.length > 1 ? 's' : '') : '') + (inc.length && warns ? ' · ' : '') + (warns ? warns + ' warning' + (warns > 1 ? 's' : '') : '') + '</span>' : '<span class="pill ok">All sources complete</span>';
      h += '<span>Backend generated <b class="mono">' + esc(fmtDT(S.data.generatedAt) || 'unknown time') + '</b></span>';
      if (S.loadedAt) h += '<span>Fetched <span class="mono">' + esc(showDT.format(S.loadedAt)) + '</span></span><span style="color:var(--mute)">Backend caches for about 5 minutes; a refresh inside that window may return the same snapshot.</span>';
      if (inc.length || warns) h += '<button class="btn btn-ghost" data-goto="quality" style="padding:3px 9px">Review data quality</button>';
    }
    el.innerHTML = h;
  }

  /* ---------- filter options ---------- */
  function fillSelect(id, values, allLabel) {
    var el = $(id), cur = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    el.value = values.indexOf(cur) >= 0 ? cur : '';
  }
  function uniq(arr) { var m = Object.create(null); arr.forEach(function (v) { m[v] = 1; }); return Object.keys(m).sort(function (a, b) { return (a === UNKNOWN) - (b === UNKNOWN) || a.localeCompare(b); }); }
  function buildOptions() {
    var d = S.data; if (!d) return;
    var geoRows = [].concat(d.users, d.businesses, d.payments);
    fillSelect('fCountry', uniq(geoRows.map(countryLab)), 'All countries');
    var regRows = S.f.country ? geoRows.filter(function (r) { return countryLab(r) === S.f.country; }) : geoRows;
    fillSelect('fRegion', uniq(regRows.map(function (r) { return lab(r.region); })), 'All regions');
    fillSelect('fGender', uniq(d.users.map(function (u) { return genderLab(u.gender); })), 'All');
    fillSelect('fSource', uniq(d.users.map(function (u) { return lab(u.source); })), 'All sources');
    fillSelect('fPlan', uniq(d.businesses.map(function (b) { return lab(b.planTier); }).concat(d.payments.map(function (p) { return lab(p.planTier); }))), 'All plans');
    fillSelect('fBilling', uniq(d.businesses.map(function (b) { return lab(b.billingState); })), 'All states');
    var sizes = uniq(d.businesses.map(sizeLab)); sizes.sort(function (a, b) { return SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b); });
    fillSelect('fSize', sizes, 'All sizes');
  }
  function filterSummary() {
    var parts = [];
    if (S.f.from || S.f.to) parts.push('Dates ' + (S.f.from ? fmtDate(S.f.from + 'T12:00:00Z') : 'start') + ' to ' + (S.f.to ? fmtDate(S.f.to + 'T12:00:00Z') : 'today') + ' (inclusive, Europe/London)');
    else parts.push('All dates');
    var names = { country: 'Country', region: 'Region', gender: 'Sex/gender', source: 'Source', plan: 'Plan', billing: 'Billing', size: 'Size' };
    Object.keys(names).forEach(function (k) { if (S.f[k]) parts.push(names[k] + ': ' + S.f[k]); });
    if (S.f.verified) parts.push(S.f.verified === 'yes' ? 'Verified only' : 'Unverified only');
    return parts.join(' · ');
  }
  function scopeFilters() {
    var users = S.tab === 'users', biz = S.tab === 'businesses' || S.tab === 'payments';
    document.querySelectorAll('.f[data-scope]').forEach(function (el) {
      var on = S.tab === 'overview' || S.tab === 'quality' || (el.dataset.scope === 'users' ? users : biz);
      el.classList.toggle('dim', !on);
      el.title = on ? '' : 'Not applied on this tab';
    });
    $('filterNote').textContent = filterSummary() + '. Date filter uses sign-up date for users, creation date for businesses, paid date for payments and event time for activity. Sex, identity and source filters apply to users; plan, billing and size apply to businesses and their payments.';
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    var el = document.querySelector('[data-panel="overview"]');
    if (!S.data) { el.innerHTML = S.error ? errBox() : skeleton(); return; }
    var d = S.data, F = filtered(false), T = d.totals || {};
    var verified = F.users.filter(function (u) { return u.identityVerified === true; }).length;
    var activeBiz = F.businesses.filter(function (b) { return b.active === true; }).length;
    var mbc = moneyByCurrency(F.payments);
    var uniqDevices = {}; F.activity.forEach(function (a) { var k = a.uid || a.deviceId; if (k) uniqDevices[k] = 1; });
    var rangeTxt = (S.f.from || S.f.to) ? 'in selected range' : 'all loaded records';

    var h = '<div class="alltime" aria-label="All-time totals"><div class="lead"><b>All-time, unfiltered</b><span>Backend totals. Not affected by filters.</span></div>' +
      cell(T.uniqueUsers, 'Unique users') + cell(T.legacyRecords, 'Legacy records (pre-dedupe)') + cell(T.businesses, 'Businesses') + cell(T.payments, 'Paid invoices') + cell(T.events, 'Activity events') + '</div>';

    h += '<div class="kpis">' +
      kpi('Users', gated('users', nf(F.users.length)), verified + ' verified (' + pct(verified, F.users.length) + ') · ' + rangeTxt, '#2f3f73') +
      kpi('Businesses', gated('businesses', nf(F.businesses.length)), (srcNote('businesses') || activeBiz + ' marked active · ' + rangeTxt), '#c2412b') +
      kpi('Paid invoices', gated('payments', nf(F.payments.length)), srcNote('payments') ? srcNote('payments') : mbc.length ? mbc.length + ' currenc' + (mbc.length > 1 ? 'ies' : 'y') + ', kept separate' : 'No paid invoices', '#9a6a12') +
      kpi('Activity events', gated('activity', nf(F.activity.length)), nf(Object.keys(uniqDevices).length) + ' distinct users/devices', '#45424a') +
      '</div>';

    h += '<div class="grid2"><div class="card"><h3>New users</h3><p class="sub">Accounts by sign-up date (Europe/London). Weekly buckets when the range exceeds 120 days.</p>' + columnChart(dailySeries(F.users, 'createdAt'), 'sign-ups') + '</div>' +
      '<div class="card"><h3>Venue subscription payments collected</h3><p class="sub">Gross amounts collected on Stripe paid invoices, before refunds. Not net revenue. Per currency, never summed across currencies.</p>' + moneyBlock(mbc) + '</div></div>';

    var cs = (d.dataQuality || {}).consumerSpend;
    h += '<p class="filter-note" style="padding:0 2px 12px">Consumer restaurant and Panda Credit spending: <b>not measured</b>' + (cs ? ' (' + esc(typeof cs === 'string' ? cs : (cs.note || cs.status || 'unavailable')) + ')' : '') + '. Figures above are venue subscription payments only.</p>';
    h += '<div class="grid3">' +
      '<div class="card"><h3>Users by country</h3><p class="sub">Reported or legacy country; not verified</p>' + barList(countBy(F.users, countryLab)) + '</div>' +
      '<div class="card"><h3>Reported sex / gender</h3><p class="sub">Self-reported or legacy value; not verified. Unknown is never inferred</p>' + barList(countBy(F.users, function (u) { return genderLab(u.gender); }), { color: '#c2412b' }) + '</div>' +
      '<div class="card"><h3>Sign-in provider</h3><p class="sub">Identity: ' + verified + ' verified, ' + (F.users.length - verified) + ' not verified or unknown</p>' + barList(countBy(F.users, function (u) { return lab(u.provider); }), { color: '#45424a' }) + '</div></div>';

    h += '<div class="grid3">' +
      '<div class="card"><h3>Businesses by country</h3><p class="sub">Filtered businesses</p>' + barList(countBy(F.businesses, countryLab), { color: '#c2412b' }) + '</div>' +
      '<div class="card"><h3>Plan tier</h3><p class="sub">Current plan on business record</p>' + barList(countBy(F.businesses, function (b) { return lab(b.planTier); }), { color: '#9a6a12' }) + '</div>' +
      '<div class="card"><h3>Billing state</h3><p class="sub">As reported by backend</p>' + barList(countBy(F.businesses, function (b) { return lab(b.billingState); }), { color: '#2f3f73' }) + '</div></div>';

    h += '<div class="grid2"><div class="card"><h3>Activity over time</h3><p class="sub">All tracked events by day</p>' + columnChart(dailySeries(F.activity, 'ts'), 'events') + '</div>' +
      '<div class="card"><h3>Event types</h3><p class="sub">Filtered activity</p>' + barList(countBy(F.activity, function (a) { return lab(a.type); }), { color: '#45424a' }) + '</div></div>';
    el.innerHTML = h;
  }
  function cell(v, k) { return '<div class="cell"><div class="n">' + (v == null ? '<span style="opacity:.6">n/a</span>' : nf(v)) + '</div><div class="k">' + esc(k) + '</div></div>'; }
  function kpi(k, n, s, c) { return '<div class="kpi" style="--accent:' + c + '"><div class="k">' + esc(k) + '</div><div class="n' + (/Unavailable/.test(n) ? ' na' : '') + '">' + n + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function moneyBlock(mbc) {
    var st = srcState('payments');
    if (st === 'unavailable') return '<div class="errbox"><b>Unavailable</b>The payments source was not read for this load, so no amount is shown.</div>';
    var pre = st === 'partial' ? '<p class="q-list"><span style="display:block;padding:8px 10px;border-radius:8px;background:var(--ochre-soft);color:#5e3e00;font-size:13px;margin-bottom:8px">Payments source incomplete: totals below are partial minimums.</span></p>' : '';
    return pre + moneyInner(mbc);
  }
  function moneyInner(mbc) {
    if (!mbc.length) return '<div class="empty">No paid invoices in the selected range.</div>';
    return '<div class="money-list">' + mbc.map(function (m) { return '<div class="money-row"><span>' + esc(m.currency) + ' · ' + m.count + ' invoice' + (m.count > 1 ? 's' : '') + '</span><b>' + (m.currency === UNKNOWN ? nf(m.total) + ' (currency missing)' : money(m.total, m.currency)) + '</b></div>'; }).join('') + '</div>';
  }
  function skeleton() { return '<div class="kpis">' + [1, 2, 3, 4].map(function () { return '<div class="sk" style="height:96px"></div>'; }).join('') + '</div><div class="grid2"><div class="sk" style="height:260px"></div><div class="sk" style="height:260px"></div></div>'; }
  function errBox() { return '<div class="errbox"><b>Data could not be loaded</b>' + esc(S.error) + ' No figures are shown because a failed load is not the same as zero activity.<br><button class="btn" data-retry>Try again</button></div>'; }

  /* ---------- tables ---------- */
  var COLS = {
    users: [
      { k: 'name', t: 'Name' }, { k: 'email', t: 'Email', mono: 1 },
      { k: 'gender', t: 'Sex / gender (reported)', v: function (r) { return genderLab(r.gender); } },
      { k: 'age', t: 'Age', num: 1 },
      { k: 'country', t: 'Country', v: countryLab }, { k: 'region', t: 'Region', v: function (r) { return lab(r.region); } },
      { k: 'provider', t: 'Provider' },
      { k: 'identityVerified', t: 'Identity', v: verifiedLab, tag: function (v) { return v === 'Verified' ? 'v' : v === 'Unverified' ? 'o' : ''; } },
      { k: 'source', t: 'Source' },
      { k: 'createdAt', t: 'Signed up', date: 1 }, { k: 'lastSignInAt', t: 'Last sign-in', date: 1 },
      { k: 'signInCount', t: 'Sign-ins', num: 1 }, { k: 'legacyRecordCount', t: 'Legacy rows', num: 1 }
    ],
    businesses: [
      { k: 'businessName', t: 'Venue', v: bizName }, { k: 'ownerName', t: 'Owner' }, { k: 'ownerEmail', t: 'Owner email', mono: 1 },
      { k: 'category', t: 'Category' }, { k: 'country', t: 'Country', v: countryLab }, { k: 'region', t: 'Region', v: function (r) { return lab(r.region); } },
      { k: 'employeeCount', t: 'Employees (people)', num: 1 }, { k: 'seatCapacity', t: 'Seats (covers)', num: 1 },
      { k: 'planTier', t: 'Plan' }, { k: 'planPeriod', t: 'Period' },
      { k: 'billingState', t: 'Billing', tag: function (v) { v = String(v).toLowerCase(); return /active|paid/.test(v) ? 'v' : /past|unpaid|cancel|fail/.test(v) ? 'r' : /trial/.test(v) ? 'o' : ''; } },
      { k: 'active', t: 'Active', v: function (r) { return r.active === true ? 'Yes' : r.active === false ? 'No' : UNKNOWN; } },
      { k: 'createdAt', t: 'Created', date: 1 }, { k: 'trialEndsAt', t: 'Trial ends', date: 1 }
    ],
    payments: [
      { k: 'paidAt', t: 'Paid', date: 1, dt: 1 }, { k: 'businessName', t: 'Venue' },
      { k: 'amount', t: 'Amount', num: 1, v: major, f: function (r) { return r.currency ? money(major(r), curOf(r)) : nf(major(r)); } },
      { k: 'currency', t: 'Currency', v: curOf }, { k: 'planTier', t: 'Plan' }, { k: 'planPeriod', t: 'Period' },
      { k: 'country', t: 'Country', v: countryLab }, { k: 'region', t: 'Region', v: function (r) { return lab(r.region); } },
      { k: 'subscriptionId', t: 'Subscription', mono: 1 }, { k: 'id', t: 'Invoice', mono: 1 }
    ]
  };
  function cv(c, r) { return c.v ? c.v(r) : r[c.k]; }
  function sortRows(rows, kind) {
    var st = S.t[kind], c = COLS[kind].filter(function (x) { return x.k === st.sort; })[0]; if (!c) return rows;
    return rows.slice().sort(function (a, b) {
      var x = cv(c, a), y = cv(c, b);
      var xe = blank(x) || x === UNKNOWN, ye = blank(y) || y === UNKNOWN;
      if (xe || ye) return xe - ye; // unknowns always last
      if (c.date) { x = parse(x); y = parse(y); x = x ? x.getTime() : 0; y = y ? y.getTime() : 0; }
      else if (c.num) { x = Number(x); y = Number(y); }
      else { x = String(x).toLowerCase(); y = String(y).toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * st.dir;
    });
  }
  function renderTable(kind) {
    var el = document.querySelector('[data-panel="' + kind + '"]');
    if (!S.data) { el.innerHTML = S.error ? errBox() : '<div class="sk" style="height:420px"></div>'; return; }
    if (srcState(kind) === 'unavailable') {
      el.innerHTML = '<div class="errbox" role="status"><b>Unavailable</b>This source could not be read. No records or successful totals are shown for this load. Review Data quality for details.</div>';
      return;
    }
    var st = S.t[kind];
    var all = S.data[kind].length, unsearched = filtered(false)[kind].length;
    var rows = sortRows(filtered(true)[kind], kind);
    var pages = Math.max(1, Math.ceil(rows.length / st.size)); if (st.page >= pages) st.page = pages - 1;
    var slice = rows.slice(st.page * st.size, st.page * st.size + st.size);
    var ph = { users: 'Search name, email or user id', businesses: 'Search venue, owner, email, address', payments: 'Search venue, invoice or subscription id' }[kind];
    var sum = '';
    if (kind === 'payments') sum = ' · ' + moneyByCurrency(rows).map(function (m) { return m.currency === UNKNOWN ? nf(m.total) + ' (no currency)' : money(m.total, m.currency); }).join(' · ');
    var cols = COLS[kind];
    var h = '<div class="toolbar"><label class="sr" for="q-' + kind + '">Search</label><input type="search" id="q-' + kind + '" data-q="' + kind + '" placeholder="' + ph + '" value="' + esc(st.q) + '" />' +
      (srcNote(kind) ? '<span class="pill warn">' + esc(srcNote(kind)) + '</span>' : '') + '<span class="count"><b>' + nf(rows.length) + '</b> of ' + nf(all) + ' loaded rows' + (st.q ? ' (' + nf(unsearched) + ' before search)' : '') + esc(sum) + '</span></div>';
    if (!rows.length) {
      h += '<div class="empty">' + (all ? 'No ' + kind + ' match these filters. Try widening the date range or resetting filters.' : 'The backend returned no ' + kind + ' records.') + '</div>';
    } else {
      h += '<div class="tbl-wrap"><table><thead><tr>' + cols.map(function (c) {
        var s = st.sort === c.k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none';
        return '<th scope="col" aria-sort="' + s + '"><button data-sort="' + kind + ':' + c.k + '">' + esc(c.t) + '</button></th>';
      }).join('') + '</tr></thead><tbody>' + slice.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          var v = cv(c, r), disp;
          if (c.f) disp = esc(c.f(r));
          else if (c.date) disp = esc(c.dt ? fmtDT(v) : fmtDate(v));
          else disp = v === UNKNOWN ? '' : esc(v == null ? '' : v);
          if (disp === '' || disp === '—') disp = '<span class="unk">' + (c.date ? 'none' : 'unknown') + '</span>';
          else if (c.tag) disp = '<span class="tag ' + c.tag(v) + '">' + disp + '</span>';
          return '<td class="' + (c.num ? 'num' : '') + (c.mono ? ' mono' : '') + '">' + disp + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
      h += '<div class="pager"><label for="ps-' + kind + '">Rows</label><select id="ps-' + kind + '" data-ps="' + kind + '">' + [25, 50, 100, 250].map(function (n) { return '<option' + (n === st.size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
        '<button class="btn" data-pg="' + kind + ':-1"' + (st.page ? '' : ' disabled') + '>Previous</button><span>Page ' + (st.page + 1) + ' of ' + pages + '</span><button class="btn" data-pg="' + kind + ':1"' + (st.page < pages - 1 ? '' : ' disabled') + '>Next</button></div>';
    }
    if (kind === 'businesses') h += '<p class="sub" style="margin-top:6px">Business size = optional employee count (people) and seat capacity (covers). Blank means the venue did not report it.</p>';
    if (kind === 'payments') h += '<p class="sub" style="margin-top:6px">Venue promotion subscription invoices paid through Stripe. Gross amounts collected before refunds, not net revenue. Amounts converted from minor units using each currency\'s precision. Not consumer restaurant spend.</p>';
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.q : null;
    var caret = focused ? document.activeElement.selectionStart : null;
    el.innerHTML = h;
    if (focused === kind) { var inp = $('q-' + kind); inp.focus(); try { inp.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
  }

  /* ---------- data quality ---------- */
  function renderQuality() {
    var el = document.querySelector('[data-panel="quality"]');
    if (!S.data) { el.innerHTML = S.error ? errBox() : '<div class="sk" style="height:300px"></div>'; return; }
    var dq = S.data.dataQuality || {}, d = S.data;
    var miss = function (rows, f) { return rows.filter(function (r) { return blank(r[f]); }).length; };
    var mrow = function (label, n, tot) { return '<tr><td>' + esc(label) + '</td><td class="num">' + nf(n) + '</td><td class="num">' + pct(n, tot) + '</td></tr>'; };
    var unkG = d.users.filter(function (u) { return genderLab(u.gender) === UNKNOWN; }).length;
    var h = '<div class="grid2"><div class="card"><h3>Sources</h3><p class="sub">What the backend read for this load</p>';
    var srcs = dq.sources || [];
    h += srcs.length ? '<div class="tbl-wrap"><table><thead><tr><th>Source</th><th>Read</th><th>Complete</th><th>Limit</th><th>Note</th></tr></thead><tbody>' + srcs.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td><span class="tag ' + (s.read ? 'v' : 'r') + '">' + (s.read ? 'Yes' : 'No') + '</span></td><td><span class="tag ' + (s.complete ? 'v' : 'o') + '">' + (s.complete ? 'Complete' : 'Partial') + '</span></td><td class="num">' + (s.limit == null ? '<span class="unk">none</span>' : nf(s.limit)) + '</td><td style="white-space:normal">' + esc(s.note || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="empty">Backend did not report source details.</div>';
    h += '<h3 style="margin-top:16px">Warnings</h3>' + ((dq.warnings || []).length ? '<ul class="q-list">' + dq.warnings.map(function (w) { return '<li>' + esc(typeof w === 'string' ? w : JSON.stringify(w)) + '</li>'; }).join('') + '</ul>' : '<p class="sub">None reported.</p>');
    h += '</div><div class="card"><h3>Provenance</h3><p class="sub">Schema version ' + esc(d.schemaVersion) + '</p><div class="money-list">' +
      '<div class="money-row"><span>Money</span><b>' + esc(dq.moneySource || 'not stated') + '</b></div>' +
      '<div class="money-row"><span>Money meaning</span><b style="text-align:right">Gross collected before refunds, not net revenue</b></div>' +
      '<div class="money-row"><span>Consumer / Panda Credit spend</span><b style="text-align:right">Not measured' + (dq.consumerSpend ? ': ' + esc(typeof dq.consumerSpend === 'string' ? dq.consumerSpend : (dq.consumerSpend.note || dq.consumerSpend.status || '')) : '') + '</b></div>' +
      '<div class="money-row"><span>Demographics</span><b style="text-align:right">' + esc(dq.demographicsSource || 'not stated') + '</b></div>' +
      '<div class="money-row"><span>Generated</span><b>' + esc(fmtDT(d.generatedAt) || 'unknown') + '</b></div></div>' +
      '<h3 style="margin-top:16px">Missing fields (all loaded records)</h3><div class="tbl-wrap"><table><thead><tr><th>Field</th><th>Missing</th><th>Share</th></tr></thead><tbody>' +
      mrow('User sex / gender', unkG, d.users.length) + mrow('User country', d.users.filter(function (u) { return countryLab(u) === UNKNOWN; }).length, d.users.length) +
      mrow('User age', miss(d.users, 'age'), d.users.length) + mrow('User email', miss(d.users, 'email'), d.users.length) +
      mrow('Business employee count', d.businesses.filter(function (b) { return sizeLab(b) === UNKNOWN; }).length, d.businesses.length) +
      mrow('Business seat capacity', miss(d.businesses, 'seatCapacity'), d.businesses.length) + mrow('Business plan', miss(d.businesses, 'planTier'), d.businesses.length) +
      mrow('Payment currency', miss(d.payments, 'currency'), d.payments.length) + mrow('Activity country', miss(d.activity, 'country'), d.activity.length) +
      '</tbody></table></div></div></div>';
    el.innerHTML = h;
  }

  function render() {
    renderStatus(); scopeFilters();
    if (S.tab === 'overview') renderOverview();
    else if (S.tab === 'quality') renderQuality();
    else renderTable(S.tab);
  }

  /* ---------- loading ---------- */
  function validate(j) {
    if (!j || typeof j !== 'object') throw new Error('Unexpected response from the stats API.');
    if (j.schemaVersion !== 2) throw new Error('Stats API returned schema version ' + (j.schemaVersion == null ? 'none' : j.schemaVersion) + '; this dashboard needs version 2. The backend dashboard format may not be deployed yet.');
    ['users', 'businesses', 'activity', 'payments'].forEach(function (k) { if (!Array.isArray(j[k])) throw new Error('Stats API response is missing the "' + k + '" list.'); });
    j.dataQuality = j.dataQuality || { sources: [], warnings: ['Backend did not include a data quality block.'] };
    j.totals = j.totals || {};
    return j;
  }
  function load(key, fromSaved) {
    var id = ++S.reqId;
    S.loading = true; S.error = null; render();
    $('refresh').disabled = true;
    return fetch(API + '?format=dashboard', { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { var e = new Error('Key not recognised. Check for typos or extra spaces.'); e.auth = true; throw e; }
        return r.json().catch(function () { throw new Error('Stats API returned an unreadable response (HTTP ' + r.status + ').'); }).then(function (j) {
          if (j && j.error === 'unauthorized') { var e2 = new Error('Key not recognised.'); e2.auth = true; throw e2; }
          if (!r.ok || (j && j.error)) throw new Error((j && j.error ? j.error : 'Request failed') + ' (HTTP ' + r.status + ').');
          return validate(j);
        });
      })
      .then(function (j) {
        if (id !== S.reqId || S.key !== key) return;
        S.data = j; S.loadedAt = new Date(); S.loading = false;
        try { sessionStorage.setItem(SS_KEY, key); } catch (e) { /* storage unavailable */ }
        showApp(); buildOptions(); render();
      })
      .catch(function (e) {
        if (id !== S.reqId) return;
        S.loading = false;
        var msg = e && e.message ? e.message : 'Network error.';
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = 'Could not reach the stats API. Check your connection and try again.';
        if (e.auth) { signOut(msg); return; }
        if (!S.data && !fromSaved && $('app').hidden) { $('gateErr').textContent = msg; return; }
        S.error = msg; showApp(); render();
      })
      .then(function () { $('refresh').disabled = false; $('go').disabled = false; });
  }
  function showApp() { $('gate').hidden = true; $('app').hidden = false; }
  function signOut(msg) {
    S.reqId++; S.key = null; S.data = null; S.error = null; S.loadedAt = null; S.loading = false;
    try { sessionStorage.removeItem(SS_KEY); } catch (e) { /* ignore */ }
    setAuto(0); $('autoRefresh').value = '0';
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.innerHTML = ''; });
    $('status').innerHTML = '';
    $('app').hidden = true; $('gate').hidden = false; $('key').value = '';
    $('gateErr').textContent = msg || ''; $('key').focus();
  }
  function setAuto(min) {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
    min = Number(min);
    if (min >= 5) S.timer = setInterval(function () { if (S.key && !S.loading && document.visibilityState === 'visible') load(S.key, false); }, min * 60000);
  }

  /* ---------- export ---------- */
  function sheetRows(kind, rows) {
    var cols = COLS[kind];
    var head = cols.map(function (c) { return c.t; });
    if (kind === 'users') head.push('User id');
    if (kind === 'businesses') head.push('Address', 'Place id', 'Business id');
    if (kind === 'payments') head.push('Business id', 'Customer id');
    var body = rows.map(function (r) {
      var line = cols.map(function (c) {
        var v = cv(c, r);
        if (c.k === 'amount') return v == null ? null : { n: v };
        if (c.date) return blank(v) ? null : (c.dt ? fmtDT(v) : fmtDate(v));
        if (c.num) return v == null || v === '' || isNaN(v) ? null : { n: Number(v) };
        return v == null ? null : String(v);
      });
      if (kind === 'users') line.push(r.uid || r.id || null);
      if (kind === 'businesses') line.push(r.address || null, r.placeId || null, r.id == null ? null : String(r.id));
      if (kind === 'payments') line.push(r.businessId == null ? null : String(r.businessId), r.customerId || null);
      return line;
    });
    return [head].concat(body);
  }
  function toSheet(aoa) {
    var ws = {}, maxC = 0;
    aoa.forEach(function (row, R) {
      maxC = Math.max(maxC, row.length);
      row.forEach(function (v, C) {
        if (v == null) return;
        var ref = XLSX.utils.encode_cell({ r: R, c: C });
        if (typeof v === 'object' && 'n' in v) ws[ref] = { t: 'n', v: v.n };
        else if (typeof v === 'number') ws[ref] = { t: 'n', v: v };
        else ws[ref] = { t: 's', v: String(v) }; // explicit string cell: never a formula
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, aoa.length - 1), c: Math.max(0, maxC - 1) } });
    ws['!cols'] = new Array(maxC).fill(0).map(function () { return { wch: 18 }; });
    return ws;
  }
  function metaRows(F, kindLabel) {
    var dq = S.data.dataQuality || {};
    var dates = function (rows, f) { var k = rows.map(function (r) { return dayKey(r[f]); }).filter(Boolean).sort(); return k.length ? k[0] + ' to ' + k[k.length - 1] : 'none'; };
    var rows = [['Panda Ledger export'], ['Contents', kindLabel], ['Exported', showDT.format(new Date()) + ' (Europe/London)'], ['Backend generated', fmtDT(S.data.generatedAt) || 'unknown'], ['Filters', filterSummary()],
      ['Search terms', ['users', 'businesses', 'payments'].filter(function (k) { return S.t[k].q; }).map(function (k) { return k + ': ' + S.t[k].q; }).join('; ') || 'none'],
      ['Users covered dates', dates(F.users, 'createdAt')], ['Businesses covered dates', dates(F.businesses, 'createdAt')], ['Payments covered dates', dates(F.payments, 'paidAt')],
      ['Currencies', moneyByCurrency(F.payments).map(function (m) { return m.currency; }).join(', ') || 'none'],
      ['Money source', dq.moneySource || 'not stated'], ['Money note', 'Gross collected before refunds (not net revenue). Venue promotion subscriptions, converted from minor units. Currencies are never summed together.'],
      ['Demographics', (dq.demographicsSource || 'not stated') + '. Reported or legacy values; sex and country are not verified.'], ['Consumer / Panda Credit spend', 'Not measured' + (dq.consumerSpend ? ': ' + (typeof dq.consumerSpend === 'string' ? dq.consumerSpend : (dq.consumerSpend.note || dq.consumerSpend.status || '')) : '')], ['Source completeness', ['users','businesses','payments','activity'].map(function (k) { return k + ': ' + srcState(k); }).join('; ')], ['Size units', 'Employees = people; Seats = covers. Blank = not reported.'], []];
    var inc = (dq.sources || []).filter(function (s) { return !s.complete || !s.read; });
    rows.push(['Incomplete sources', inc.length ? inc.map(function (s) { return s.name + (s.note ? ' (' + s.note + ')' : ''); }).join('; ') : 'none']);
    (dq.warnings || []).forEach(function (w) { rows.push(['Warning', typeof w === 'string' ? w : JSON.stringify(w)]); });
    return rows;
  }
  function download(kind, fmt) {
    if (!S.data) return toast('Load data before exporting.');
    var F = filtered(true);
    var stamp = todayKey();
    if (fmt === 'csv') return csv(stamp);
    if (typeof XLSX === 'undefined' || !XLSX.utils) return toast('Excel library failed to load. Use CSV fallback.');
    var wb = XLSX.utils.book_new();
    var labels = { users: 'Users', businesses: 'Businesses', payments: 'Payments' };
    if (kind === 'report') {
      var sum = metaRows(F, 'Combined report');
      sum.push([], ['Metric', 'Filtered value', 'All-time (unfiltered)']);
      var T = S.data.totals || {};
      sum.push(['Users', { n: F.users.length }, T.uniqueUsers == null ? 'n/a' : { n: T.uniqueUsers }]);
      sum.push(['Verified users', { n: F.users.filter(function (u) { return u.identityVerified === true; }).length }, null]);
      sum.push(['Businesses' + (srcState('businesses') !== 'ok' ? ' (' + srcState('businesses') + ')' : ''), srcState('businesses') === 'unavailable' ? 'unavailable' : { n: F.businesses.length }, T.businesses == null ? 'n/a' : { n: T.businesses }]);
      sum.push(['Paid invoices' + (srcState('payments') !== 'ok' ? ' (' + srcState('payments') + ')' : ''), srcState('payments') === 'unavailable' ? 'unavailable' : { n: F.payments.length }, T.payments == null ? 'n/a' : { n: T.payments }]);
      sum.push(['Activity events', { n: F.activity.length }, T.events == null ? 'n/a' : { n: T.events }]);
      moneyByCurrency(F.payments).forEach(function (m) { sum.push(['Gross collected ' + m.currency + (srcState('payments') !== 'ok' ? ' (PARTIAL)' : ''), { n: Math.round(m.total * 100) / 100 }, null]); });
      XLSX.utils.book_append_sheet(wb, toSheet(sum), 'Summary');
      var cs = {}; var add = function (r, f) { var c = countryLab(r); cs[c] = cs[c] || { u: 0, b: 0, p: 0, a: 0 }; cs[c][f]++; };
      F.users.forEach(function (r) { add(r, 'u'); }); F.businesses.forEach(function (r) { add(r, 'b'); }); F.payments.forEach(function (r) { add(r, 'p'); }); F.activity.forEach(function (r) { add(r, 'a'); });
      var ctry = [['Country', 'Users', 'Businesses', 'Paid invoices', 'Activity events']].concat(Object.keys(cs).sort().map(function (c) { return [c, { n: cs[c].u }, { n: cs[c].b }, { n: cs[c].p }, { n: cs[c].a }]; }));
      XLSX.utils.book_append_sheet(wb, toSheet(ctry), 'Countries');
      ['users', 'businesses', 'payments'].forEach(function (k) { XLSX.utils.book_append_sheet(wb, toSheet(sheetRows(k, sortRows(F[k], k))), labels[k]); });
      var act = [['Time (Europe/London)', 'Type', 'User id', 'Device id', 'Venue id', 'Country', 'Region', 'Platform', 'Source']].concat(F.activity.map(function (a) { return [fmtDT(a.ts) || null, a.type || null, a.uid || null, a.deviceId || null, a.venueId == null ? null : String(a.venueId), countryLab(a), lab(a.region), a.platform || null, a.source || null]; }));
      XLSX.utils.book_append_sheet(wb, toSheet(act), 'Activity');
      var dq = S.data.dataQuality || {};
      var dqs = [['Source', 'Read', 'Complete', 'Limit', 'Note']].concat((dq.sources || []).map(function (s) { return [s.name || null, s.read ? 'Yes' : 'No', s.complete ? 'Yes' : 'No', s.limit == null ? null : { n: s.limit }, s.note || null]; }));
      dqs.push([], ['Warnings']); (dq.warnings || []).forEach(function (w) { dqs.push([typeof w === 'string' ? w : JSON.stringify(w)]); });
      XLSX.utils.book_append_sheet(wb, toSheet(dqs), 'Data quality');
    } else {
      XLSX.utils.book_append_sheet(wb, toSheet(sheetRows(kind, sortRows(F[kind], kind))), labels[kind]);
      XLSX.utils.book_append_sheet(wb, toSheet(metaRows(F, labels[kind] + ' (' + F[kind].length + ' filtered rows)')), 'About');
    }
    wb.Props = { Title: 'Panda Ledger ' + kind, Subject: filterSummary(), Author: 'Panda', CreatedDate: new Date() };
    if (fmt === 'xls' && wb.SheetNames.some(function (name) {
      var ref = wb.Sheets[name]['!ref'];
      return ref && XLSX.utils.decode_range(ref).e.r >= 65536;
    })) {
      toast('This report exceeds the .xls row limit. Choose .xlsx to keep every row.');
      return;
    }
    XLSX.writeFile(wb, 'panda-' + kind + '-' + stamp + '.' + fmt, { bookType: fmt === 'xls' ? 'biff8' : 'xlsx', compression: true });
    toast('Downloaded ' + (kind === 'report' ? 'combined report' : F[kind].length + ' ' + kind) + ' as .' + fmt);
  }
  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'object' && 'n' in v) return String(v.n);
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(stamp) {
    var kind = ['users', 'businesses', 'payments'].indexOf(S.tab) >= 0 ? S.tab : 'users';
    var F = filtered(true);
    var text = sheetRows(kind, sortRows(F[kind], kind)).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'panda-' + kind + '-' + stamp + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Downloaded ' + F[kind].length + ' ' + kind + ' as CSV');
  }
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }

  /* ---------- events ---------- */
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.tabs [role=tab]').forEach(function (b) { var on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== tab; });
    render();
  }
  function resetPages() { Object.keys(S.t).forEach(function (k) { S.t[k].page = 0; }); }
  function bind() {
    $('gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var k = $('key').value.trim();
      if (!k) { $('gateErr').textContent = 'Enter your access key.'; return; }
      $('gateErr').textContent = ''; $('go').disabled = true;
      S.key = k; load(k, false);
    });
    $('refresh').addEventListener('click', function () { if (S.key) load(S.key, false); });
    $('logout').addEventListener('click', function () { signOut(''); });
    $('autoRefresh').addEventListener('change', function (e) { setAuto(e.target.value); });
    var tabs = document.querySelectorAll('.tabs [role=tab]');
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!n) return;
        var nx = tabs[(i + n + tabs.length) % tabs.length]; nx.focus(); setTab(nx.dataset.tab);
      });
    });
    var map = { fFrom: 'from', fTo: 'to', fCountry: 'country', fRegion: 'region', fGender: 'gender', fVerified: 'verified', fSource: 'source', fPlan: 'plan', fBilling: 'billing', fSize: 'size' };
    Object.keys(map).forEach(function (id) {
      $(id).addEventListener('change', function (e) {
        S.f[map[id]] = e.target.value;
        if (id === 'fCountry') { S.f.region = ''; buildOptions(); }
        if (S.f.from && S.f.to && S.f.from > S.f.to) { var t = S.f.from; S.f.from = S.f.to; S.f.to = t; $('fFrom').value = S.f.from; $('fTo').value = S.f.to; }
        resetPages(); render();
      });
    });
    document.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.preset;
        if (p === 'all') { S.f.from = ''; S.f.to = ''; } else { S.f.to = todayKey(); S.f.from = addDays(S.f.to, -(Number(p) - 1)); }
        $('fFrom').value = S.f.from; $('fTo').value = S.f.to; resetPages(); render();
      });
    });
    $('fReset').addEventListener('click', function () {
      Object.keys(S.f).forEach(function (k) { S.f[k] = ''; });
      Object.keys(map).forEach(function (id) { $(id).value = ''; });
      Object.keys(S.t).forEach(function (k) { S.t[k].q = ''; });
      buildOptions(); resetPages(); render();
    });
    var main = $('main');
    main.addEventListener('input', function (e) {
      var k = e.target.dataset.q; if (!k) return;
      S.t[k].q = e.target.value; S.t[k].page = 0;
      clearTimeout(S._qt); S._qt = setTimeout(function () { renderTable(k); }, 160);
    });
    main.addEventListener('change', function (e) { var k = e.target.dataset.ps; if (k) { S.t[k].size = Number(e.target.value); S.t[k].page = 0; renderTable(k); } });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-sort],[data-pg],[data-retry],[data-goto]'); if (!t) return;
      if (t.dataset.sort) {
        var p = t.dataset.sort.split(':'), st = S.t[p[0]];
        if (st.sort === p[1]) st.dir = -st.dir; else { st.sort = p[1]; st.dir = 1; }
        renderTable(p[0]); var nb = document.querySelector('[data-sort="' + t.dataset.sort + '"]'); if (nb) nb.focus();
      } else if (t.dataset.pg) {
        var q2 = t.dataset.pg.split(':'); S.t[q2[0]].page += Number(q2[1]); renderTable(q2[0]);
        var pb = document.querySelector('[data-pg="' + t.dataset.pg + '"]:not([disabled])') || document.querySelector('[data-pg^="' + q2[0] + '"]:not([disabled])'); if (pb) pb.focus();
      } else if (t.hasAttribute('data-retry')) { if (S.key) load(S.key, false); }
      else if (t.dataset.goto) setTab(t.dataset.goto);
    });
    var eb = $('exportBtn'), em = $('exportMenu');
    function closeMenu() { em.hidden = true; eb.setAttribute('aria-expanded', 'false'); }
    eb.addEventListener('click', function (e) { e.stopPropagation(); var open = em.hidden; em.hidden = !open; eb.setAttribute('aria-expanded', String(open)); if (open) em.querySelector('button').focus(); });
    em.addEventListener('click', function (e) { var b = e.target.closest('[data-export]'); if (!b) return; closeMenu(); eb.focus(); download(b.dataset.export, b.dataset.fmt); });
    em.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(em.querySelectorAll('button')), i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); eb.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('click', function (e) { if (!em.hidden && !e.target.closest('.menu')) closeMenu(); });
    var tip = $('tip');
    document.addEventListener('mousemove', function (e) {
      var r = e.target.closest && e.target.closest('[data-tip]');
      if (!r) { tip.hidden = true; return; }
      tip.textContent = r.getAttribute('data-tip'); tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 270) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
    window.addEventListener('pagehide', function () { S.data = null; });
  }

  bind();
  var saved = null;
  try { saved = sessionStorage.getItem(SS_KEY); } catch (e) { /* ignore */ }
  if (saved) { S.key = saved; showApp(); setTab('overview'); load(saved, true); }
  else { $('key').focus(); }
})();
