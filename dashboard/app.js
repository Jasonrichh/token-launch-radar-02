// Token Radar 3's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// size curve's own inputs and the protocol's farm plan, and the live-token curve check.
// No network: every byte it shows is in data.js.
//
// The farm plan and the implied value below are the same derivation main.ts writes to
// board.json: the fitted curve, the category offset, growth and maturity decide the value;
// category, chains, TVL and age decide the action, the capital, the hold and every cost
// and time. No protocol name is special-cased anywhere on this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var V = DATA.validation;
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : usd.format(Math.round(n)); }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3); }
  function fmtOff(n) { return (n > 0 ? '+' : '') + n.toFixed(2); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. Curve value first, then the category offset, growth and maturity.
  function curveOf(row) {
    return Math.max(1, Math.round(Math.pow(10, V.intercept + V.slope * Math.log10(row.tvl_usd) + row.category_offset)));
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + model.growth_weight * Math.tanh(growth / model.growth_scale);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return { implied: Math.max(1, Math.round(curveOf(row) * growthMult * maturity)), growthMult: growthMult, maturity: maturity, curve: curveOf(row) };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (typeof child === 'number' || typeof child === 'boolean') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // --- Farm plans: the same derivation main.ts writes to board.json. ---
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasPerTx(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 8;
    if (c === 'solana') return 0.1;
    if (c === 'bitcoin') return 2;
    return 1;
  }
  function gasText(g) { return g >= 1 ? '$' + g : '$' + g.toFixed(2); }
  var ACTIONS = [
    [['lend', 'cdp', 'collateral'],
      'Supply {cap} of USDC to {name} on {chain} as collateral and keep the position open.',
      'Borrow $25 of a stablecoin against the deposit and repay it within the week, so the position shows both sides of the market.'],
    [['dex'],
      'Provide {cap} of liquidity to {name}\'s largest pool on {chain} and keep the position open.',
      'Swap $25 through {name} on {chain} once a week, in small size, to record trading volume.'],
    [['yield', 'aggregator', 'leveraged farm', 'farm'],
      'Deposit {cap} of USDC into {name}\'s highest-TVL vault on {chain} and keep the shares.',
      'Harvest or compound the vault\'s yield once, and re-deposit the proceeds into the same vault.'],
    [['bridge', 'cross chain'],
      'Bridge {cap} of USDC to {chain} through {name} and use the bridged funds in its app.',
      'Bridge a second, smaller amount back the other way to show two-way use of the bridge.'],
    [['staking', 'restak'],
      'Stake {cap} of the chain\'s staking asset through {name} and keep the receipt token.',
      'Restake or delegate the receipt once more, or vote in one governance poll if the protocol opens one.'],
    [['perpetual', 'derivative', 'options'],
      'Deposit {cap} of USDC as margin on {name} and open one small hedged position.',
      'Close and reopen a small position once, keeping total exposure under {cap}.'],
    [['prediction'],
      'Fund {cap} and place one small position in a market on {name}.',
      'Settle or close the position and place one more in a different market.'],
    [['rwa'],
      'Mint {cap} of {name}\'s yield-bearing asset on {chain} and hold it.',
      'Claim or reinvest one yield distribution from the position.'],
    [['stable', 'algo-stable'],
      'Mint or deposit {cap} of the stable asset through {name} on {chain}.',
      'Redeem a small amount back to USDC and re-mint it, to record a full mint-and-redeem cycle.'],
    [['insurance'],
      'Buy {cap} of cover from {name} on {chain} and keep the policy active.',
      'Extend the cover once before it lapses, rather than letting it expire.'],
    [['launchpad'],
      'Deposit {cap} of USDC into {name}\'s launch allocation on {chain} and keep the allocation.',
      'Join one launch or vote on one allocation round.'],
    [['nft'],
      'Trade about {cap} of volume through {name} on {chain}, in one or two items.',
      'Make one more trade the following week so the wallet shows repeat use.'],
    [['payment', 'card'],
      'Route {cap} of spending through {name} on {chain} and keep the account active.',
      'Make a second payment the following week.'],
    [['ai', 'agent'],
      'Run {cap} of inference or agent tasks through {name} on {chain}.',
      'Run a second task and leave feedback or a rating in the app.'],
    [['index'],
      'Buy {cap} of {name}\'s index on {chain} and hold the shares.',
      'Add $25 to the position once, or rebalance it if the app offers that.'],
    [['chain'],
      'Bridge {cap} of USDC to {name} and use one native app on the chain.',
      'Make one transaction in a second native app on the same chain.'],
    [['curator', 'allocator', 'risk'],
      'Deposit {cap} into a {name} vault on {chain} and keep the shares.',
      'Move $25 between two of the vault\'s allocations.'],
    [['basis'],
      'Deposit {cap} of USDC into {name}\'s basis strategy on {chain} and keep the position open.',
      'Add $25 to the position after the first funding round.'],
    [['synthetic'],
      'Mint {cap} of synthetic assets through {name} on {chain} and hold them.',
      'Burn a small amount back and re-mint it, to record a full cycle.'],
    [['governance'],
      'Lock {cap} of assets in {name}\'s governance on {chain} and vote once.',
      'Vote in a second proposal.']
  ];
  function fill(tpl, p, capital, chain) {
    return tpl.replace('{cap}', '$' + capital).replace('{name}', p.name).replace('{chain}', chain);
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      var keys = ACTIONS[i][0];
      for (var j = 0; j < keys.length; j++) {
        if (c.indexOf(keys[j]) >= 0) return [fill(ACTIONS[i][1], p, capital, chain), fill(ACTIONS[i][2], p, capital, chain)];
      }
    }
    return [fill('Deposit {cap} of USDC into {name} on {chain} and keep the position open.', p, capital, chain),
      'Make one more qualifying action in the app, such as a swap, a deposit or a vote.'];
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasPerTx(chain);
    var weeks = Math.ceil(hold / 7);
    var txs = 2 + weeks + 1;
    var gasTotal = Math.round(gas * txs * 100) / 100;
    var total = Math.round((capital + gasTotal) * 100) / 100;
    var calc = impliedOf(p, DATA.model);
    var bp = Math.round((total / Math.max(1, calc.implied)) * 10000 * 100) / 100;
    var main = actionsFor(p, capital, chain);
    function step(text, cost, time) { return { text: text, cost: cost, time: time }; }
    return [
      step('Open a fresh wallet that holds only the funds you plan to farm, fund it with $' + capital + ' plus gas on ' + chain + ', and keep its seed phrase offline.', gasText(gas) + ' of gas for the first transaction', '10 minutes'),
      step(main[0], '$' + capital + ' of capital and ' + gasText(gas) + ' of gas', '15 minutes to set up'),
      step(main[1], 'about $25 of volume and ' + gasText(gas) + ' of gas', '10 minutes'),
      step('Repeat one qualifying action each week, such as a deposit, a swap, a vote or a claim, so the wallet shows steady activity.', 'about $' + (Math.round(gas * weeks * 100) / 100) + ' of gas over ' + weeks + ' weeks', '10 minutes a week'),
      step('Open ' + p.name + '\'s own points or rewards page from the link the protocol itself publishes and check the position is counted.', 'no fee to check', '10 minutes'),
      step('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      step('If a token is announced, claim only from the protocol\'s own page or announcement, and never pay anyone to claim for you.', 'gas only, never a claim fee', '10 minutes'),
      step('Net it out: $' + capital + ' of capital plus $' + gasTotal + ' of gas over ' + txs + ' transactions is $' + total + ' out of pocket. The farm pays for itself if a launch pays you ' + bp + ' basis points of the $' + calc.implied.toLocaleString('en-US') + ' implied value.', '$' + total + ' all in', hold + ' days, then unwind in two parts')
    ];
  }
  function stepString(s) {
    var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
    if (t.length > 600) t = t.slice(0, 596) + '...';
    return t;
  }

  // --- Filtering, sorting, hash state. ---
  var watchlistSet = {};
  (DATA.watchlist || []).forEach(function (s) { watchlistSet[s] = true; });
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.tab !== 'pre') parts.push('tab=' + state.tab);
    if (state.selected) parts.push('detail=' + state.selected);
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    var h = parts.join('&');
    if (('' + location.hash).replace(/^#/, '') !== h) history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }
  function applyHash() {
    var h = readHash();
    state.tab = h.tab === 'live' ? 'live' : 'pre';
    state.selected = h.detail || null;
    state.category = h.cat || 'all';
    state.chain = h.chain || 'all';
    state.watch = h.watch === '1';
    state.q = h.q || '';
    state.sort = h.sort || 'implied';
    state.view = h.view || '';
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !watchlistSet[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'breakeven') { va = a.breakeven_bp; vb = b.breakeven_bp; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      return (va - vb) * dir || (a.slug < b.slug ? -1 : 1);
    });
  }
  function openDetail(slug) { state.selected = slug; state.tab = 'pre'; writeHash(); render(); scrollToDetail(); }
  function scrollToDetail() {
    var d = document.querySelector('.detail');
    if (d) d.scrollIntoView({ block: 'start' });
  }

  // --- Rendering. ---
  function header() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'kicker', text: 'Token Radar 3 · fitted size curve · ' + DATA.as_of }),
      el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
      el('p', { class: 'lede' }, 'A radar over ', el('b', { text: DATA.board_size + ' pre-token protocols' }),
        ' from a sealed DefiLlama snapshot. Every row is priced by one size curve fitted on the ',
        el('b', { text: V.train_size + ' tokens that already trade' }),
        ', then adjusted for its category, its seven-day growth and how long it has run with no token. ',
        'Each row carries a farm plan netted to the dollar.'));
  }
  function stats() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var med = DATA.rows.slice().map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var mid = med[Math.floor(med.length / 2)] || 0;
    return el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('div', { class: 'num', text: String(DATA.board_size) }), el('div', { class: 'lbl', text: 'protocols ranked (' + DATA.watchlist_size + ' on the watchlist)' })),
      el('div', { class: 'stat' }, el('div', { class: 'num', text: fmtUsd(total) }), el('div', { class: 'lbl', text: 'implied value across the board' })),
      el('div', { class: 'stat' }, el('div', { class: 'num', text: fmtUsd(mid) }), el('div', { class: 'lbl', text: 'median implied value' })),
      el('div', { class: 'stat' }, el('div', { class: 'num', text: 'R² ' + V.r_squared.toFixed(3) }), el('div', { class: 'lbl', text: 'size curve on ' + V.train_size + ' live tokens' })));
  }
  function validationPanel() {
    var offs = V.offsets.slice().sort(function (a, b) { return b.offset - a.offset; });
    var rows = offs.map(function (o) {
      return el('tr', {},
        el('td', {}, el('b', { text: o.category })),
        el('td', { class: 'num', text: fmtOff(o.offset) }),
        el('td', { class: 'num', text: 'x' + Math.pow(10, o.offset).toFixed(2) }),
        el('td', { class: 'num', text: String(o.samples) }));
    });
    return el('section', { class: 'panel' },
      el('h2', { text: 'How the radar was tested' }),
      el('p', {}, 'The curve is fitted, not asserted: ', el('b', { class: 'mono', text: 'log10(market cap) = ' + V.intercept + ' + ' + V.slope + ' x log10(TVL)' }),
        ', ordinary least squares over the ', el('b', { text: String(V.train_size) }), ' live-token protocols in the snapshot that record a market cap above zero (exchanges excluded). ',
        'A bigger protocol’s token is worth more than a smaller one’s, but only as roughly the square root of its size.'),
      el('div', { class: 'testgrid' },
        el('div', { class: 'test' }, el('div', { class: 'num', text: 'R² ' + V.r_squared.toFixed(3) }), el('div', { class: 'lbl', text: 'TVL explains 14% of a token’s value — the curve is a yardstick, not a price' })),
        el('div', { class: 'test' }, el('div', { class: 'num', text: V.loo_median_log_err.toFixed(2) + ' dex' }), el('div', { class: 'lbl', text: 'leave-one-out median error; ' + Math.round(V.loo_within_2x * 100) + '% of predictions land within 2x of the real market cap' })),
        el('div', { class: 'test' }, el('div', { class: 'num', text: V.split_median_log_err === null ? 'n/a' : V.split_median_log_err.toFixed(2) + ' dex' }), el('div', { class: 'lbl', text: 'time split: fitted on listings before ' + (V.split_cutoff || '—') + ' (n=' + V.split_train_size + '), tested on the ' + V.split_test_size + ' listed after' })),
        el('div', { class: 'test' }, el('div', { class: 'num', text: '±0.4 dex' }), el('div', { class: 'lbl', text: 'category offsets are shrunk by n / (n + 5) and clamped — no category may move a price more than 2.5x' }))),
      el('p', {}, 'Read the rank, not the dollar: the implied value is the curve’s reading plus the protocol’s own growth and age. A rank that survives a weak curve is a rank worth farming.'),
      el('table', { class: 'offsets' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { text: 'Offset (log10)' }), el('th', { text: 'Factor' }), el('th', { text: 'Live samples' }))),
        el('tbody', {}, rows)));
  }
  function leaders() {
    var top = DATA.rows.slice(0, 3);
    return el('div', { class: 'leaders' }, top.map(function (r) {
      return el('button', { type: 'button', class: 'leader', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rk', text: '#' + r.rank }),
        el('span', { class: 'nm', text: r.name }),
        el('span', { class: 'vl', text: fmtUsd(r.implied_value_usd) + ' implied' }));
    }));
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; writeHash(); render(); } });
    var cat = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; writeHash(); render(); } },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null, text: c }); }));
    var ch = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; writeHash(); render(); } },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null, text: c }); }));
    var sort = el('select', { 'aria-label': 'Sort by', onchange: function (e) { state.sort = e.target.value; writeHash(); render(); } },
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['breakeven', 'Sort: cheapest bet']].map(function (o) {
        return el('option', { value: o[0], selected: state.sort === o[0] ? 'selected' : null, text: o[1] });
      }));
    var watch = el('label', {},
      el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, onchange: function (e) { state.watch = e.target.checked; writeHash(); render(); } }),
      document.createTextNode(' Watchlist only'));
    return el('div', { class: 'controls' }, q, cat, ch, sort, watch);
  }
  function boardTable(list) {
    if (list.length === 0) return el('p', { class: 'empty', text: 'No protocols match this filter.' });
    var head = el('thead', {}, el('tr', {},
      el('th', { class: 'rk', text: '#' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { class: 'money', text: 'TVL' }),
      el('th', { class: 'money', text: '7d' }),
      el('th', { class: 'money', text: 'Age' }),
      el('th', { class: 'money', text: 'Implied value' }),
      el('th', { class: 'money', text: 'Break-even' })));
    var body = el('tbody', {}, list.map(function (r) {
      var calc = impliedOf(r, DATA.model);
      var match = calc.implied === r.implied_value_usd ? '' : ' ⚠';
      return el('tr', { onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'rk num', text: String(r.rank) }),
        el('td', {}, el('b', { text: r.name }), ' ', watchlistSet[r.slug] ? el('span', { class: 'pill watch', text: 'WATCHLIST' }) : null,
          el('br'), el('span', { class: 'pill', text: (r.chains || []).slice(0, 3).join(' · ') || '—' })),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'money num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'money num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'money num', text: fmtAge(r.age_days) }),
        el('td', { class: 'money num', text: fmtUsd(r.implied_value_usd) + match }),
        el('td', { class: 'money num bp', text: r.breakeven_bp + ' bp' }));
    }));
    return el('table', { class: 'board' }, head, body);
  }
  function detailView() {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
    if (!row) return null;
    var calc = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    var gas = row.gas_total_usd;
    return el('section', { class: 'detail' },
      el('button', { type: 'button', class: 'back', onclick: function () { state.selected = null; writeHash(); render(); }, text: '← Back to the board' }),
      el('h2', { text: '#' + row.rank + ' · ' + row.name }),
      el('p', { class: 'sub' }, (row.category || 'Other') + ' · ' + (row.chains || []).join(', ') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · ' + fmtAge(row.age_days) + ' old · records no token'),
      el('div', { class: 'flow' },
        el('div', { class: 'step' }, el('div', { class: 'k', text: 'Size curve' }), el('div', { class: 'v', text: fmtUsd(calc.curve) })),
        el('div', { class: 'step eq', text: '×' }),
        el('div', { class: 'step' }, el('div', { class: 'k', text: 'Category offset ' + fmtOff(row.category_offset) }), el('div', { class: 'v', text: 'x' + Math.pow(10, row.category_offset).toFixed(2) })),
        el('div', { class: 'step eq', text: '×' }),
        el('div', { class: 'step' }, el('div', { class: 'k', text: 'Growth ' + fmtPct(row.change_7d) }), el('div', { class: 'v', text: fmtMult(calc.growthMult) })),
        el('div', { class: 'step eq', text: '×' }),
        el('div', { class: 'step' }, el('div', { class: 'k', text: 'Maturity ' + fmtAge(row.age_days) }), el('div', { class: 'v', text: fmtMult(calc.maturity) })),
        el('div', { class: 'step eq', text: '=' }),
        el('div', { class: 'step' }, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) }))),
      el('div', { class: 'econ' },
        el('div', { class: 'box' }, el('div', { class: 'num', text: '$' + row.capital_usd }), el('div', { class: 'lbl', text: 'capital in the position' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: '$' + gas }), el('div', { class: 'lbl', text: 'gas over the whole plan' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: '$' + row.total_cost_usd }), el('div', { class: 'lbl', text: 'all in, out of pocket' })),
        el('div', { class: 'box' }, el('div', { class: 'num', text: row.breakeven_bp + ' bp' }), el('div', { class: 'lbl', text: 'break-even share of the implied value' }))),
      el('h3', { text: 'Farm plan — netted to the dollar' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', {}, document.createTextNode(stepString(s).replace(/ Cost: .*$/, '')), el('br'), el('span', { class: 'cost', text: 'Cost: ' + s.cost + ' · Time: ' + s.time }));
      })));
  }
  function liveTable() {
    var rows = DATA.live || [];
    var head = el('thead', {}, el('tr', {},
      el('th', { text: 'Token' }), el('th', { text: 'Category' }), el('th', { class: 'money', text: 'TVL' }),
      el('th', { class: 'money', text: 'Market cap (real)' }), el('th', { class: 'money', text: 'Curve says' }), el('th', { class: 'money', text: 'Real / curve' })));
    var body = el('tbody', {}, rows.map(function (r) {
      return el('tr', {},
        el('td', {}, el('b', { text: r.name })),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'money num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'money num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'money num', text: fmtUsd(r.predicted_mcap_usd) }),
        el('td', { class: 'money num', text: r.ratio === null ? 'n/a' : 'x' + r.ratio.toFixed(2) }));
    }));
    return el('div', {},
      el('p', { class: 'lede' }, 'The same curve, run over the tokens that already trade. Where the curve reads high the market disagrees; where it reads low, the market pays more than size alone explains. This is the yardstick’s report card, on the snapshot’s own figures.'),
      el('table', { class: 'board' }, head, body));
  }
  function footer() {
    return el('p', { class: 'note' },
      'Snapshot: ', DATA.source, ' · as of ', DATA.as_of, '. “Records no token” means the snapshot’s record carries no token — it is not proof a protocol has none. ',
      'Implied values are this radar’s own claims, computed from the snapshot by ', DATA.model_version, '; the curve is fitted on ', String(V.train_size),
      ' live-token protocols and its tests are printed above. Farm plans are derived from each protocol’s own category, chains, TVL and age; no protocol name is special-cased.');
  }
  function render() {
    applyHash();
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var frag = document.createDocumentFragment();
    frag.appendChild(header());
    frag.appendChild(stats());
    frag.appendChild(validationPanel());
    var tabs = el('div', { class: 'tabs' },
      el('button', { type: 'button', class: 'tab', 'aria-selected': state.tab === 'pre' ? 'true' : 'false', onclick: function () { state.tab = 'pre'; state.selected = null; writeHash(); render(); }, text: 'Pre-token board (' + DATA.board_size + ')' }),
      el('button', { type: 'button', class: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; state.selected = null; writeHash(); render(); }, text: 'Live tokens: curve check (' + (DATA.live || []).length + ')' }));
    frag.appendChild(tabs);
    if (state.tab === 'live') {
      frag.appendChild(liveTable());
    } else {
      var det = detailView();
      if (det) frag.appendChild(det);
      frag.appendChild(leaders());
      frag.appendChild(controls());
      var list = sortedRows(rows());
      frag.appendChild(el('p', { class: 'lede', text: list.length + ' of ' + DATA.board_size + ' protocols shown.' }));
      frag.appendChild(boardTable(list));
    }
    frag.appendChild(footer());
    app.appendChild(frag);
    // A hash that opens a view puts that view in front of the reader: a detail link
    // shows the detail, a filter link or #view=table shows the table it filters.
    // Deferred one tick so the scroll lands after the first paint: scrolling before
    // the page has painted leaves a headless capture blank.
    setTimeout(function () {
      if (state.selected) {
        scrollToDetail();
      } else if (state.view === 'table' || state.watch || state.category !== 'all' || state.chain !== 'all' || state.q || state.sort !== 'implied') {
        var c = document.querySelector('.controls');
        if (c) c.scrollIntoView();
      }
    }, 0);
  }
  window.addEventListener('hashchange', function () { render(); });
  render();
})();
