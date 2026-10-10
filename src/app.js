const { $, $$, h, esc, busy, toast, md, store, download } = Kit;
let model = null, selected = null;

/* ================= rendering ================= */
const ccColor = (cc) => (cc > 10 ? 'var(--bad)' : cc > 6 ? 'var(--warn)' : 'var(--good)');

function renderAll() {
  const m = model;
  const avg = m.fns.length ? m.fns.reduce((a, f) => a + f.cc, 0) / m.fns.length : 0;
  const worst = [...m.fns].sort((a, b) => b.cc - a.cc)[0];
  const tiles = [
    ['Functions', m.fns.length], ['Lines of code', m.loc], ['Maintainability', m.fileMI.toFixed(0) + '/100'],
    ['Avg complexity', avg.toFixed(1)], ['Max complexity', worst ? `${worst.cc} · ${worst.short}` : '—'], ['Issues', m.fns.reduce((a, f) => a + f.issues.length, 0)],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:18px">${esc(v)}</div></div>`).join('');
  const rows = [...m.fns].sort((a, b) => b.cc - a.cc);
  $('#fnTable').innerHTML = `<tr><th>Function</th><th>CC</th><th>Depth</th><th>LOC</th><th>MI</th><th>Calls / by</th><th>Notes</th></tr>` + rows.map((f) => `<tr data-i="${m.fns.indexOf(f)}" class="${f === selected ? 'sel' : ''}"><td class="mono">${esc(f.name)}${f.async ? ' <span class="tag">async</span>' : ''}${f.exported ? ' <span class="tag accent">export</span>' : ''}</td><td><span class="cx" style="background:${ccColor(f.cc)}">${f.cc}</span></td><td>${f.maxDepth}</td><td>${f.loc}</td><td>${f.mi.toFixed(0)}</td><td>${f.edges.size} / ${f.callers}</td><td>${f.issues.map(([k, t]) => `<span class="tag ${k}">${t}</span>`).join(' ')}</td></tr>`).join('');
  $$('#fnTable tr[data-i]').forEach((tr) => (tr.onclick = () => select(m.fns[+tr.dataset.i])));
  renderGraph();
  renderCode();
}

/* force-directed layout */
function renderGraph() {
  const svg = $('#graph');
  const W = svg.clientWidth || 600, H = 360;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const nodes = [model.top, ...model.fns].filter((f) => !f.isTop || f.edges.size);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const edges = [];
  nodes.forEach((n) => n.edges.forEach((t) => idx.has(t) && edges.push([idx.get(n), idx.get(t)])));
  const P = nodes.map((n, i) => ({ x: W / 2 + Math.cos(i * 2.4) * 120, y: H / 2 + Math.sin(i * 2.4) * 100, vx: 0, vy: 0, r: n.isTop ? 9 : 7 + Math.min(14, n.cc * 1.3) }));
  for (let it = 0; it < 400; it++) {
    const alpha = 1 - it / 400;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d2 = dx * dx + dy * dy + 0.01;
      const f = 2600 / d2;
      const d = Math.sqrt(d2);
      dx /= d; dy /= d;
      P[i].vx -= dx * f; P[i].vy -= dy * f; P[j].vx += dx * f; P[j].vy += dy * f;
    }
    edges.forEach(([a, b]) => {
      const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 90) * 0.02;
      P[a].vx += (dx / d) * f; P[a].vy += (dy / d) * f; P[b].vx -= (dx / d) * f; P[b].vy -= (dy / d) * f;
    });
    P.forEach((p) => {
      p.vx += (W / 2 - p.x) * 0.004; p.vy += (H / 2 - p.y) * 0.006;
      p.x += Math.max(-20, Math.min(20, p.vx * alpha)); p.y += Math.max(-20, Math.min(20, p.vy * alpha));
      p.vx *= 0.6; p.vy *= 0.6;
      p.x = Math.max(p.r + 40, Math.min(W - p.r - 40, p.x)); p.y = Math.max(p.r + 8, Math.min(H - p.r - 16, p.y));
    });
  }
  let s = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker></defs>`;
  edges.forEach(([a, b]) => {
    const A = P[a], B = P[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const x2 = B.x - (dx / d) * (B.r + 3), y2 = B.y - (dy / d) * (B.r + 3);
    s += `<path class="edge" d="M${A.x},${A.y} Q${(A.x + B.x) / 2 - dy * 0.12},${(A.y + B.y) / 2 + dx * 0.12} ${x2},${y2}" marker-end="url(#arr)"/>`;
  });
  nodes.forEach((n, i) => {
    const p = P[i];
    s += `<g class="gn ${n === selected ? 'sel' : ''}" data-i="${i}" transform="translate(${p.x},${p.y})"><circle r="${p.r}" fill="${n.isTop ? 'var(--muted)' : ccColor(n.cc)}" fill-opacity=".85"/><text y="${p.r + 12}" text-anchor="middle">${esc(n.short)}</text><title>${esc(n.name)} · CC ${n.cc}</title></g>`;
  });
  svg.innerHTML = s;
  $$('#graph .gn').forEach((g) => (g.onclick = () => { const n = nodes[+g.dataset.i]; if (!n.isTop) select(n); }));
}

/* syntax highlighting with acorn tokens */
function renderCode() {
  const { src, toks, fns } = model;
  const fnNames = new Set(fns.map((f) => f.short));
  const marks = [];
  toks.forEach((t) => {
    let cls = null;
    if (t.type.keyword) cls = 'k';
    else if (t.type.label === 'string' || t.type.label === 'template' || t.type.label === '`') cls = 's';
    else if (t.type.label === 'num') cls = 'n';
    else if (t.type.label === 'name' && fnNames.has(t.value)) cls = 'f';
    if (cls) marks.push([t.start, t.end, cls]);
  });
  acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowReturnOutsideFunction: true, onComment: (_, __, s, e) => marks.push([s, e, 'c']) });
  marks.sort((a, b) => a[0] - b[0]);
  let html = '', pos = 0;
  marks.forEach(([s, e, c]) => { if (s < pos) return; html += esc(src.slice(pos, s)) + `<span class="tok-${c}">${esc(src.slice(s, e))}</span>`; pos = e; });
  html += esc(src.slice(pos));
  // split while keeping spans balanced per line
  const lines = []; let open = null;
  html.split('\n').forEach((ln) => {
    let line = (open ? `<span class="${open}">` : '') + ln;
    const opens = [...ln.matchAll(/<span class="([^"]+)">/g)].length, closes = (ln.match(/<\/span>/g) || []).length;
    if (opens > closes || (open && closes === 0)) { open = open && closes === 0 ? open : ln.match(/<span class="([^"]+)">(?!.*<\/span>)/)?.[1] || open; line += '</span>'; }
    else open = null;
    lines.push(line);
  });
  const sel = selected;
  $('#view').innerHTML = lines.map((l, i) => `<span class="ln${sel && i + 1 >= sel.line && i + 1 <= sel.endLine ? ' hl' : ''}" data-n="${i + 1}">${l || ' '}</span>`).join('');
}

function setView(code) {
  $('#view').classList.toggle('hidden', !code);
  $('#src').classList.toggle('hidden', code);
  $('#toggleView').textContent = code ? 'Edit' : 'View highlighted';
}

function select(f) {
  selected = f;
  renderAll();
  setView(true);
  const firstHl = $('#view .ln.hl');
  if (firstHl) $('#view').scrollTop = firstHl.offsetTop - 40;
  const p = $('#fnPanel');
  const out = h('div', { class: 'prose ai-out', style: 'margin-top:12px' });
  p.innerHTML = '';
  p.append(
    h('div', { class: 'row between' }, h('h2', { class: 'mono', style: 'margin:0' }, f.name), h('span', { class: 'small muted' }, `lines ${f.line}–${f.endLine} · ${f.params} params · ${f.returns} returns`)),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm primary', onclick: (e) => busy(e.currentTarget, () => aiAction('explain', f, out)) }, 'Explain'),
      h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, () => aiAction('refactor', f, out)) }, 'Refactor'),
      h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, () => aiAction('tests', f, out)) }, 'Unit tests'),
      h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, () => aiAction('bugs', f, out)) }, 'Bug hunt')),
    out);
}

/* ================= AI ================= */
async function aiAction(kind, f, out) {
  const code = model.src.slice(f.start, f.end);
  const ctx = `Function: ${f.name} (complexity ${f.cc}, nesting ${f.maxDepth}, ${f.loc} lines)\nCalls: ${[...f.edges].map((e) => e.name).join(', ') || 'none'}\nCalled by ${f.callers} function(s).\n\n\`\`\`js\n${code}\n\`\`\``;
  const prompts = {
    explain: 'Explain what this function does for a new teammate: a one-line summary, then how it works step by step (short bullets), inputs/outputs, and side effects. Markdown, max 180 words.',
    refactor: 'Suggest a refactor that lowers cyclomatic complexity and improves readability without changing behavior. Give a 1-2 sentence rationale, then the full refactored function in a ```js block. Keep the same name and signature.',
    tests: 'Write a focused Jest test suite for this function: happy path, edge cases, and one error case. Mock collaborators if needed. Output only a ```js block with brief comments.',
    bugs: 'Review this function for bugs and risky edge cases (null/undefined, off-by-one, async errors, mutation, floating point). List each finding as a bullet with severity [high|med|low] and a one-line fix. If none, say so. Markdown.',
  };
  const text = await AI.chat([{ role: 'system', content: 'You are a senior JavaScript engineer and careful code reviewer.' }, { role: 'user', content: prompts[kind] + '\n\n' + ctx }], { temperature: 0.3, maxTokens: 1500, demo: () => demo(kind, f, code) });
  out.innerHTML = md(text);
}

function demo(kind, f, code) {
  const tag = '\n\n*(Demo output generated from local metrics. Add a free key for real AI review.)*';
  if (kind === 'explain') return `**${f.name}** ${f.async ? 'asynchronously ' : ''}takes ${f.params} parameter${f.params === 1 ? '' : 's'} and ${f.returns ? `returns in ${f.returns} place${f.returns === 1 ? '' : 's'}` : 'returns nothing'}.\n\n- It has cyclomatic complexity **${f.cc}**, so there are about ${f.cc} independent paths to test.\n- It calls: ${[...f.edges].map((e) => '`' + e.short + '`').join(', ') || 'no other local functions'}.\n- Max nesting depth is ${f.maxDepth}.` + tag;
  if (kind === 'refactor') return `Flatten nested conditionals with **guard clauses** and extract the inner loop body into a helper. That should cut complexity from ${f.cc} to roughly ${Math.max(1, Math.ceil(f.cc / 2))}.\n\n\`\`\`js\n${code.split('\n').slice(0, 12).join('\n')}\n  // …demo: early returns + extracted helper go here\n\`\`\`` + tag;
  if (kind === 'tests') return `\`\`\`js\ndescribe('${f.short}', () => {\n  test('handles the happy path', () => {\n    // arrange / act / assert\n  });\n  test('handles empty input', () => {});\n  test('throws or fails gracefully on invalid input', () => {});\n});\n\`\`\`` + tag;
  return `- **[med]** Check that ${f.params ? 'parameters' : 'inputs'} can't be \`undefined\` before property access.\n- **[low]** ${f.cc > 6 ? 'Many branches. Make sure every branch is covered by tests.' : 'Looks straightforward.'}` + tag;
}

async function moduleSummary(out) {
  const list = model.fns.map((f) => `${f.name}(cc=${f.cc}, calls=${[...f.edges].map((e) => e.short).join('|') || '-'})`).join('\n');
  const text = await AI.chat([
    { role: 'system', content: 'You are a software architect. Summarize a JavaScript module: purpose (1-2 sentences), main responsibilities (bullets), the riskiest functions and why, and the 3 highest-leverage improvements. Markdown, max 220 words.' },
    { role: 'user', content: `Metrics:\n${list}\n\nSource (truncated):\n${model.src.slice(0, 9000)}` },
  ], { temperature: 0.3, demo: `**Purpose:** a shopping-cart pricing module that applies promotions, taxes and shipping.\n\n- **Riskiest:** \`${[...model.fns].sort((a, b) => b.cc - a.cc)[0].short}\`, which concentrates most of the branching.\n- **Dead code:** ${model.fns.filter((f) => f.issues.some((i) => i[1] === 'never called')).map((f) => '`' + f.short + '`').join(', ') || 'none detected'}.\n\n**Improvements:** 1) split promotion rules into a strategy table; 2) centralize money rounding; 3) add tests around tax edge cases.\n\n*(demo)*` });
  out.innerHTML = md(text);
}

/* ================= wiring ================= */
function run() {
  const src = $('#src').value;
  try {
    model = analyze(src);
    selected = null;
    $('#parseStatus').textContent = `Parsed ${model.toks.length.toLocaleString()} tokens with acorn ✓`;
    renderAll();
    setView(true);
    const out = h('div', { class: 'prose', style: 'margin-top:12px' });
    $('#fnPanel').innerHTML = '';
    $('#fnPanel').append(h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, 'Module overview'), h('button', { class: 'btn sm primary', onclick: (e) => busy(e.currentTarget, () => moduleSummary(out)) }, 'AI architecture summary')), h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Or pick a function in the table or graph.'), out);
  } catch (e) {
    $('#parseStatus').textContent = '⚠ ' + e.message;
    toast('Parse error: ' + e.message, 'err');
    setView(false);
  }
}
$('#analyze').onclick = run;
$('#toggleView').onclick = () => setView($('#view').classList.contains('hidden'));
$('#src').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(); if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 2; } });
$('#file').onchange = async (e) => { const f = e.target.files[0]; if (f) { $('#src').value = await f.text(); run(); } e.target.value = ''; };
window.addEventListener('resize', () => model && renderGraph());

$('#src').value = `// cart.js: pricing engine for a small online store
import { fetchRates } from './tax-service.js';

const TAX_FALLBACK = 0.13;

export class Cart {
  constructor(customer) {
    this.customer = customer;
    this.items = [];
  }

  add(product, qty = 1) {
    if (qty <= 0) throw new Error('Quantity must be positive');
    const existing = this.items.find((i) => i.sku === product.sku);
    if (existing) existing.qty += qty;
    else this.items.push({ ...product, qty });
    return this;
  }

  subtotal() {
    return this.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  async total(promoCode) {
    const discount = applyPromotions(this, promoCode);
    const taxRate = await resolveTaxRate(this.customer?.region);
    const shipping = shippingFor(this);
    return roundMoney((this.subtotal() - discount) * (1 + taxRate) + shipping);
  }
}

export function applyPromotions(cart, code) {
  let discount = 0;
  const sub = cart.subtotal();
  if (code) {
    if (code === 'WELCOME10' && cart.customer && cart.customer.orders === 0) {
      discount += sub * 0.1;
    } else if (code.startsWith('BULK')) {
      for (const item of cart.items) {
        if (item.qty >= 10) {
          if (item.category === 'books' || item.category === 'stationery') discount += item.price * item.qty * 0.15;
          else discount += item.price * item.qty * 0.05;
        }
      }
    } else if (code === 'VIP' && cart.customer?.tier === 'gold') {
      discount += Math.min(sub * 0.2, 100);
    }
  }
  if (sub > 500 && !code) discount += 25;
  return Math.min(discount, sub);
}

async function resolveTaxRate(region) {
  try {
    const rates = await fetchRates();
    return rates[region] ?? TAX_FALLBACK;
  } catch (err) {
    console.warn('tax service down', err);
    return TAX_FALLBACK;
  }
}

function shippingFor(cart) {
  const weight = cart.items.reduce((w, i) => w + (i.weight || 0) * i.qty, 0);
  if (cart.subtotal() >= 100) return 0;
  return weight > 5 ? 14.99 : weight > 1 ? 7.99 : 4.99;
}

const roundMoney = (n) => Math.round(n * 100) / 100;

function legacyCouponCheck(code) {
  return /^[A-Z0-9]{4,12}$/.test(code);
}
`;
run();


/* ================= Project page (multi-file) ================= */
let project = store.get('project', null) || DEMO_PROJECT.map((f) => ({ ...f }));
let projModel = null, curFile = 0;
const saveProject = () => store.set('project', project);
function runProject() {
  projModel = analyzeProject(project);
  renderProject();
}
function renderProject() {
  const list = $('#fileList');
  list.innerHTML = '';
  project.forEach((f, i) => {
    const info = projModel.files.find((x) => x.name === f.name) || {};
    list.append(h('div', { class: 'file-item' + (i === curFile ? ' on' : ''), onclick: () => { curFile = i; renderProject(); } },
      h('span', { class: 'mono grow' }, f.name),
      info.error ? h('span', { class: 'tag bad', title: info.error }, 'parse error') : h('span', { class: 'small muted' }, `${info.fns} fn · ${info.loc} loc`)));
  });
  const f = project[curFile];
  $('#fileName').value = f ? f.name : '';
  $('#fileSrc').value = f ? f.src : '';
  const fns = projModel.fns, h1 = healthScore(fns);
  $('#projKpis').innerHTML = [['Files', project.length], ['Functions', fns.length], ['Lines', projModel.files.reduce((a, x) => a + (x.loc || 0), 0)], ['Imports', projModel.imports.length], ['Cross-file calls', projModel.crossCalls.length], ['Health', `${h1.grade} · ${h1.score}`]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:18px">${v}</div></div>`).join('');
  drawImportGraph();
  $('#projErrors').innerHTML = projModel.errors.map((e) => `<div class="err">⚠ ${esc(e.file)}: ${esc(e.message)}</div>`).join('');
}
function drawImportGraph() {
  const svg = $('#importGraph'), W = svg.clientWidth || 640, H = 300;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const files = projModel.files.map((f) => f.name);
  // layer by longest import chain so dependencies sit to the right of their importers
  const depth = {};
  const dfs = (n, seen = new Set()) => { if (depth[n] != null) return depth[n]; if (seen.has(n)) return 0; seen.add(n); const outs = projModel.imports.filter((e) => e.from === n).map((e) => e.to); depth[n] = outs.length ? 1 + Math.max(...outs.map((o) => dfs(o, seen))) : 0; return depth[n]; };
  files.forEach((f) => dfs(f));
  const maxD = Math.max(0, ...Object.values(depth));
  const cols = {};
  files.forEach((f) => (cols[maxD - depth[f]] ||= []).push(f));
  const pos = {};
  Object.entries(cols).forEach(([c, fs]) => fs.forEach((f, i) => { pos[f] = { x: 70 + (+c * (W - 160)) / Math.max(1, maxD), y: ((i + 1) * H) / (fs.length + 1) }; }));
  let s = '<defs><marker id="ia" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker></defs>';
  projModel.imports.forEach((e) => { const a = pos[e.from], b = pos[e.to]; if (a && b) s += `<path d="M${a.x + 52},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x - 56},${b.y}" fill="none" stroke="var(--accent)" stroke-opacity=".6" stroke-width="1.6" marker-end="url(#ia)"/>`; });
  files.forEach((f) => { const p = pos[f], info = projModel.files.find((x) => x.name === f); s += `<g transform="translate(${p.x},${p.y})"><rect x="-54" y="-16" width="108" height="32" rx="8" fill="var(--panel)" stroke="${info.error ? 'var(--bad)' : 'var(--line)'}"/><text text-anchor="middle" y="4" font-size="11" fill="var(--text)" font-family="var(--mono)">${esc(f.split('/').pop())}</text><title>${esc(f)}</title></g>`; });
  svg.innerHTML = s;
}
$('#saveFile').onclick = () => { const f = project[curFile]; if (!f) return; f.name = $('#fileName').value.trim() || f.name; f.src = $('#fileSrc').value; saveProject(); runProject(); toast('File saved and re-analyzed'); };
$('#addFile').onclick = () => { project.push({ name: `src/file${project.length + 1}.js`, src: '// paste code here\n' }); curFile = project.length - 1; saveProject(); runProject(); };
$('#delFile').onclick = () => { if (project.length < 2 || !confirm('Remove this file from the project?')) return; project.splice(curFile, 1); curFile = 0; saveProject(); runProject(); };
$('#uploadFiles').onchange = async (e) => {
  const fs = [...e.target.files].filter((f) => /\.(m?js|cjs|jsx)$/i.test(f.name));
  for (const f of fs) project.push({ name: (f.webkitRelativePath || f.name).replace(/^[^/]+\//, ''), src: await f.text() });
  if (fs.length) { curFile = project.length - fs.length; saveProject(); runProject(); toast(`Added ${fs.length} file${fs.length > 1 ? 's' : ''}`); }
  e.target.value = '';
};
$('#resetProject').onclick = () => { if (!confirm('Replace the project with the sample?')) return; project = DEMO_PROJECT.map((f) => ({ ...f })); curFile = 0; saveProject(); runProject(); };

/* ================= Report page ================= */
function renderReport() {
  if (!projModel) projModel = analyzeProject(project);
  const fns = projModel.fns, hs = healthScore(fns);
  const loc = projModel.files.reduce((a, x) => a + (x.loc || 0), 0);
  $('#grade').innerHTML = `<div class="grade g${hs.grade}">${hs.grade}</div><div><div class="v" style="font-size:22px;font-weight:700">${hs.score}/100</div><div class="small muted">${fns.length} functions · ${loc} lines · ${project.length} files</div></div>`;
  $('#breakdown').innerHTML = hs.breakdown.map(([k, v, max]) => `<div class="brow"><span>${k}</span><div class="bar"><span style="width:${(100 * v) / max}%"></span></div><b class="mono">${v}/${max}</b></div>`).join('');
  const hist = histogram(fns.map((f) => f.cc), 6, 1, 19), mx = Math.max(1, ...hist), labels = ['1–3', '4–6', '7–9', '10–12', '13–15', '16+'];
  $('#ccHist').innerHTML = `<svg viewBox="0 0 360 150" width="100%" role="img" aria-label="Complexity distribution">${hist.map((v, i) => { const bh = (v / mx) * 110; return `<rect x="${i * 60 + 8}" y="${120 - bh}" width="44" height="${bh}" rx="4" fill="${i >= 3 ? 'var(--bad)' : i >= 2 ? 'var(--warn)' : 'var(--good)'}"/><text x="${i * 60 + 30}" y="${115 - bh}" text-anchor="middle" font-size="11" fill="var(--text)">${v || ''}</text><text x="${i * 60 + 30}" y="138" text-anchor="middle" font-size="10" fill="var(--muted)">${labels[i]}</text>`; }).join('')}</svg>`;
  $('#hotspots').innerHTML = `<table><tr><th>Function</th><th>File</th><th>CC</th><th>LOC</th><th>MI</th></tr>${hotspots(fns, 10).map((f) => `<tr><td class="mono">${esc(f.name)}</td><td class="small">${esc(f.file || '')}</td><td><span class="cx" style="background:${ccColor(f.cc)}">${f.cc}</span></td><td>${f.loc}</td><td>${Math.round(f.mi)}</td></tr>`).join('')}</table>`;
  const withIssues = fns.filter((f) => f.issues.length);
  $('#issueList').innerHTML = withIssues.length ? withIssues.map((f) => `<div class="list-item"><span class="mono grow">${esc(f.name)} <span class="small muted">${esc(f.file || '')}</span></span>${f.issues.map(([k, t]) => `<span class="tag ${k}">${t}</span>`).join(' ')}</div>`).join('') : '<div class="empty">No issues found.</div>';
}
$('#exportReport').onclick = () => { if (!projModel) projModel = analyzeProject(project); download('code-health-report.md', reportMarkdown('project', projModel.fns, projModel.files.reduce((a, x) => a + (x.loc || 0), 0)), 'text/markdown'); };
$('#aiSummary').onclick = (e) => busy(e.currentTarget, async () => {
  const fns = projModel.fns, hs = healthScore(fns);
  const text = await AI.chat([
    { role: 'system', content: 'You are a staff engineer writing a short code-health summary for a team lead. From the metrics, give: a 2-sentence verdict, the top 3 refactoring priorities (cite function names and why), and one process suggestion. Markdown, max 200 words.' },
    { role: 'user', content: reportMarkdown('project', fns, 0) + `\nImports: ${JSON.stringify(projModel.imports)}\nCross-file calls: ${projModel.crossCalls.length}` },
  ], { temperature: 0.3, demo: `**Verdict:** grade ${hs.grade}. The code is mostly small and readable, but complexity is concentrated in a couple of functions.\n\n1. **${hotspots(fns, 1)[0]?.name}**: the biggest hotspot. Split its branches into named helpers or a lookup table.\n2. **Dead code** (${fns.filter((f) => f.issues.some((i) => i[1] === 'never called')).map((f) => '`' + f.name + '`').join(', ') || 'none'}): delete it or wire it up.\n3. **Nested conditionals**: flatten with guard clauses.\n\n**Process:** fail CI when a new function exceeds complexity 10.\n\n*(demo summary)*` });
  $('#aiOut').innerHTML = md(text);
});

/* ================= History page ================= */
let snaps = store.get('snapshots', null);
if (!snaps) {
  snaps = [];
  const t = Date.now();
  [[24, 'Initial import'], [16, 'Added coupons'], [9, 'Checkout flow'], [3, 'Refactor discounts']].forEach(([d, label], i) => {
    const s = snapshot(label, analyzeProject(DEMO_PROJECT.slice(0, Math.min(4, i + 1))).fns, 20 + i * 18);
    s.date = t - d * 864e5; snaps.push(s);
  });
  store.set('snapshots', snaps);
}
function renderHistory() {
  const box = $('#snapList');
  box.innerHTML = snaps.length ? `<table><tr><th>Date</th><th>Label</th><th>Grade</th><th>Functions</th><th>Avg CC</th><th>Max CC</th><th>Issues</th><th>Δ vs previous</th><th></th></tr>${snaps.map((s, i) => { const d = i ? compareSnapshots(snaps[i - 1], s) : null; return `<tr><td class="small">${new Date(s.date).toLocaleDateString()}</td><td>${esc(s.label)}</td><td><b>${s.grade}</b> <span class="small muted">${s.score}</span></td><td>${s.fns}</td><td>${s.avgCC}</td><td>${s.maxCC}</td><td>${s.issues}</td><td class="small">${d ? `<span style="color:${d.score >= 0 ? 'var(--good)' : 'var(--bad)'}">${d.score >= 0 ? '+' : ''}${d.score} score</span> · ${d.avgCC >= 0 ? '+' : ''}${d.avgCC} CC` : '—'}</td><td><button class="btn ghost sm" data-del="${s.id}" aria-label="Delete snapshot">✕</button></td></tr>`; }).join('')}</table>` : '<div class="empty">No snapshots yet.</div>';
  $$('#snapList [data-del]').forEach((b) => (b.onclick = () => { snaps = snaps.filter((s) => String(s.id) !== b.dataset.del); store.set('snapshots', snaps); renderHistory(); }));
  const W = 640, H = 180, n = snaps.length;
  if (n < 2) { $('#trend').innerHTML = '<p class="small muted">Take two or more snapshots to see a trend.</p>'; return; }
  const x = (i) => 40 + (i * (W - 60)) / (n - 1), y = (v) => H - 24 - (v / 100) * (H - 40);
  const maxCC = Math.max(...snaps.map((s) => s.avgCC), 1), yc = (v) => H - 24 - (v / maxCC) * (H - 40);
  $('#trend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Health trend">${[0, 50, 100].map((v) => `<line x1="40" x2="${W - 20}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="8" y="${y(v) + 4}" font-size="10" fill="var(--muted)">${v}</text>`).join('')}<polyline fill="none" stroke="var(--good)" stroke-width="2.5" points="${snaps.map((s, i) => x(i) + ',' + y(s.score)).join(' ')}"/><polyline fill="none" stroke="var(--warn)" stroke-width="2" stroke-dasharray="5 4" points="${snaps.map((s, i) => x(i) + ',' + yc(s.avgCC)).join(' ')}"/>${snaps.map((s, i) => `<text x="${x(i)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="var(--muted)">${esc(s.label.slice(0, 14))}</text>`).join('')}</svg><div class="small muted"><span style="color:var(--good)">━</span> health score &nbsp; <span style="color:var(--warn)">┅</span> average complexity (scaled)</div>`;
}
$('#takeSnap').onclick = () => {
  if (!projModel) projModel = analyzeProject(project);
  const label = prompt('Label for this snapshot', 'Snapshot ' + (snaps.length + 1));
  if (!label) return;
  snaps.push(snapshot(label, projModel.fns, projModel.files.reduce((a, x) => a + (x.loc || 0), 0)));
  store.set('snapshots', snaps); renderHistory(); toast('Snapshot saved');
};

Router.on('project', runProject);
Router.on('report', () => { projModel = analyzeProject(project); renderReport(); });
Router.on('history', renderHistory);
