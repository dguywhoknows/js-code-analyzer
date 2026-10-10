/* Static analysis of JavaScript source (pure; needs the global `acorn` parser). */
var BRANCH = new Set(['IfStatement', 'ConditionalExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause']);
var NEST = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement']);
var isFn = (n) => n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);

function children(node) {
  const out = [];
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && out.push(x));
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

function propName(key) { return key ? (key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : key.type === 'PrivateIdentifier' ? '#' + key.name : null) : null; }

function analyze(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const fns = [];
  const top = { name: '(module)', short: '(module)', cc: 1, depth: 0, maxDepth: 0, calls: new Set(), params: 0, returns: 0, start: ast.start, end: ast.end, line: 1, endLine: ast.loc.end.line, isTop: true };
  const exported = new Set();

  function record(name, fnNode, kind, owner) {
    const r = { name, short: name.split('.').pop(), kind, cc: 1, depth: 0, maxDepth: 0, calls: new Set(), params: fnNode.params.length, returns: 0, async: !!fnNode.async, start: fnNode.start, end: fnNode.end, line: fnNode.loc.start.line, endLine: fnNode.loc.end.line, owner };
    fns.push(r);
    return r;
  }

  function visit(node, ctx, cls) {
    if (!node) return;
    // named function sites
    if (node.type === 'FunctionDeclaration' && node.id) return visitFn(node, record(node.id.name, node, 'function'), cls);
    if (node.type === 'VariableDeclarator' && isFn(node.init) && node.id.type === 'Identifier') { visit(node.id, ctx, cls); return visitFn(node.init, record(node.id.name, node.init, node.init.type === 'ArrowFunctionExpression' ? 'arrow' : 'function'), cls); }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') { const cn = node.id?.name || 'AnonymousClass'; if (node.superClass) visit(node.superClass, ctx, cls); node.body.body.forEach((m) => visit(m, ctx, cn)); return; }
    if (node.type === 'MethodDefinition' && isFn(node.value)) return visitFn(node.value, record((cls ? cls + '.' : '') + (propName(node.key) || 'method'), node.value, node.kind === 'constructor' ? 'constructor' : 'method', cls), cls);
    if (node.type === 'PropertyDefinition' && isFn(node.value)) return visitFn(node.value, record((cls ? cls + '.' : '') + (propName(node.key) || 'field'), node.value, 'method', cls), cls);
    if (node.type === 'Property' && isFn(node.value) && propName(node.key)) return visitFn(node.value, record(propName(node.key), node.value, 'method'), cls);
    if (node.type === 'AssignmentExpression' && isFn(node.right) && node.left.type === 'MemberExpression') {
      const nm = src.slice(node.left.start, node.left.end).replace(/^module\.exports\.|^exports\./, '');
      if (/^(module\.)?exports/.test(src.slice(node.left.start, node.left.end))) exported.add(nm);
      return visitFn(node.right, record(nm, node.right, 'function'), cls);
    }
    if (node.type === 'ExportNamedDeclaration') { const dcl = node.declaration; if (dcl?.id) exported.add(dcl.id.name); dcl?.declarations?.forEach((x) => x.id?.name && exported.add(x.id.name)); node.specifiers?.forEach((s) => exported.add(s.local.name)); }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration?.id) exported.add(node.declaration.id.name);

    // metrics
    if (BRANCH.has(node.type)) ctx.cc++;
    if (node.type === 'SwitchCase' && node.test) ctx.cc++;
    if (node.type === 'LogicalExpression') ctx.cc++;
    if (node.type === 'ReturnStatement') ctx.returns++;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const c = node.callee;
      if (c.type === 'Identifier') ctx.calls.add(c.name);
      else if (c.type === 'MemberExpression' && !c.computed) ctx.calls.add('.' + propName(c.property));
    }
    const nests = NEST.has(node.type) && !(node.type === 'IfStatement' && ctx._elseIf === node);
    if (nests) { ctx.depth++; ctx.maxDepth = Math.max(ctx.maxDepth, ctx.depth); }
    if (node.type === 'IfStatement' && node.alternate?.type === 'IfStatement') ctx._elseIf = node.alternate;
    children(node).forEach((c) => visit(c, ctx, cls));
    if (nests) ctx.depth--;
  }
  function visitFn(fnNode, rec, cls) { fnNode.params.forEach((p) => visit(p, rec, cls)); visit(fnNode.body, rec, cls); }
  ast.body.forEach((n) => visit(n, top, null));

  // resolve calls to known functions
  const byName = new Map(), byShort = new Map();
  fns.forEach((f) => { byName.set(f.name, f); if (!byShort.has(f.short)) byShort.set(f.short, []); byShort.get(f.short).push(f); });
  const all = [top, ...fns];
  all.forEach((f) => {
    f.edges = new Set();
    f.calls.forEach((c) => {
      const targets = c.startsWith('.') ? (byShort.get(c.slice(1)) || []) : byName.has(c) ? [byName.get(c)] : (byShort.get(c) || []).filter((t) => !t.owner);
      targets.forEach((t) => t !== f && f.edges.add(t));
    });
  });
  fns.forEach((f) => { f.callers = all.filter((g) => g.edges.has(f)).length; f.exported = exported.has(f.name) || exported.has(f.short); });

  // Halstead-ish volume via acorn tokenizer
  const toks = [...acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module' })];
  const halstead = (a, b) => {
    const ops = new Map(), opd = new Map();
    let N = 0;
    toks.forEach((t) => {
      if (t.start < a || t.end > b) return;
      N++;
      const isOperand = t.type.label === 'name' || t.type.label === 'num' || t.type.label === 'string' || t.type.label === 'template' || t.type.label === 'regexp';
      const key = t.type.label + ':' + (t.value ?? t.type.label);
      (isOperand ? opd : ops).set(key, 1);
    });
    const n = Math.max(2, ops.size + opd.size);
    return N * Math.log2(n);
  };
  const mi = (vol, cc, loc) => Math.max(0, Math.min(100, ((171 - 5.2 * Math.log(Math.max(1, vol)) - 0.23 * cc - 16.2 * Math.log(Math.max(1, loc))) * 100) / 171));
  fns.forEach((f) => { f.loc = f.endLine - f.line + 1; f.volume = halstead(f.start, f.end); f.mi = mi(f.volume, f.cc, f.loc); f.issues = issues(f); });
  const loc = src.split('\n').filter((l) => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
  const totalCC = fns.reduce((a, f) => a + f.cc, 0) + top.cc - 1;
  return { ast, fns, top, toks, loc, fileMI: mi(halstead(0, src.length), totalCC, loc), src };
}

function issues(f) {
  const out = [];
  if (f.cc > 10) out.push(['bad', 'high complexity']); else if (f.cc > 6) out.push(['warn', 'moderate complexity']);
  if (f.maxDepth > 3) out.push(['warn', `nesting depth ${f.maxDepth}`]);
  if (f.params > 4) out.push(['warn', `${f.params} params`]);
  if (f.loc > 50) out.push(['warn', 'long function']);
  if (!f.callers && !f.exported && f.kind !== 'constructor' && f.kind !== 'method') out.push(['warn', 'never called']);
  return out;
}


/* ---------- project-level analysis ---------- */
function resolveImport(from, spec, names) {
  if (!/^\.\.?\//.test(spec)) return null;
  var parts = from.split('/').slice(0, -1);
  spec.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
  var base = parts.join('/');
  return [base, base + '.js', base + '.mjs', base + '/index.js'].find(function (c) { return names.indexOf(c) >= 0; }) || null;
}
function analyzeProject(files) {
  var names = files.map(function (f) { return f.name; });
  var out = { files: [], fns: [], imports: [], errors: [] };
  files.forEach(function (f) {
    try {
      var m = analyze(f.src);
      m.fns.forEach(function (fn) { fn.file = f.name; });
      var deps = [];
      m.ast.body.forEach(function (n) {
        var src = n.type === 'ImportDeclaration' ? n.source.value : (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source ? n.source.value : null;
        if (!src) return;
        var to = resolveImport(f.name, src, names);
        deps.push({ spec: src, to: to, names: (n.specifiers || []).map(function (s) { return s.imported ? s.imported.name || s.imported.value : 'default'; }) });
        if (to) out.imports.push({ from: f.name, to: to });
      });
      out.files.push({ name: f.name, loc: m.loc, mi: m.fileMI, fns: m.fns.length, deps: deps, model: m });
      out.fns = out.fns.concat(m.fns);
    } catch (e) {
      out.errors.push({ file: f.name, message: e.message });
      out.files.push({ name: f.name, error: e.message });
    }
  });
  // cross-file calls: an unresolved call to a name exported by an imported file
  out.crossCalls = [];
  out.files.forEach(function (f) {
    if (!f.model) return;
    var imported = {};
    f.deps.forEach(function (d) { if (d.to) d.names.forEach(function (n) { imported[n] = d.to; }); });
    f.model.fns.concat([f.model.top]).forEach(function (fn) {
      fn.calls.forEach(function (c) {
        var target = imported[c];
        if (!target) return;
        var tf = out.fns.find(function (x) { return x.file === target && (x.name === c || x.short === c); });
        if (tf) { out.crossCalls.push({ from: (fn.file || f.name) + ':' + fn.name, to: target + ':' + tf.name }); tf.callers = (tf.callers || 0) + 1; tf.issues = issues(tf); }
      });
    });
  });
  return out;
}

/* Equal-width histogram over [lo, hi]; values above hi land in the last bin. */
function histogram(values, bins, lo, hi) {
  var counts = new Array(bins).fill(0), w = (hi - lo) / bins;
  values.forEach(function (v) { var i = Math.floor((v - lo) / w); counts[Math.max(0, Math.min(bins - 1, i))]++; });
  return counts;
}

/* 0-100 health score with letter grade, from per-function complexity and issues. */
function healthScore(fns) {
  if (!fns.length) return { score: 100, grade: 'A', breakdown: [] };
  var avgCC = fns.reduce(function (a, f) { return a + f.cc; }, 0) / fns.length;
  var complexShare = fns.filter(function (f) { return f.cc > 10; }).length / fns.length;
  var avgMI = fns.reduce(function (a, f) { return a + (f.mi || 0); }, 0) / fns.length;
  var dead = fns.filter(function (f) { return (f.issues || []).some(function (i) { return i[1] === 'never called'; }); }).length / fns.length;
  var parts = [
    ['Average complexity', Math.max(0, 30 - Math.max(0, avgCC - 2) * 4), 30],
    ['Share of very complex functions', Math.max(0, 25 - complexShare * 100), 25],
    ['Maintainability index', Math.min(30, avgMI * 0.4), 30],
    ['Dead code', Math.max(0, 15 - dead * 60), 15],
  ].map(function (p) { return [p[0], Math.round(p[1]), p[2]]; });
  var score = parts.reduce(function (a, p) { return a + p[1]; }, 0);
  return { score: score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F', breakdown: parts };
}

/* Hotspots: complexity weighted by size, the functions most worth refactoring first. */
function hotspots(fns, n) {
  return fns.slice().sort(function (a, b) { return b.cc * Math.sqrt(b.loc) - a.cc * Math.sqrt(a.loc); }).slice(0, n || 10);
}

function snapshot(label, fns, loc) {
  var h = healthScore(fns);
  return {
    id: Date.now() + Math.random(), label: label, date: Date.now(), fns: fns.length, loc: loc,
    avgCC: fns.length ? +(fns.reduce(function (a, f) { return a + f.cc; }, 0) / fns.length).toFixed(2) : 0,
    maxCC: fns.reduce(function (a, f) { return Math.max(a, f.cc); }, 0),
    issues: fns.reduce(function (a, f) { return a + (f.issues || []).length; }, 0),
    score: h.score, grade: h.grade,
  };
}
function compareSnapshots(a, b) {
  var out = {};
  ['fns', 'loc', 'avgCC', 'maxCC', 'issues', 'score'].forEach(function (k) { out[k] = +(b[k] - a[k]).toFixed(2); });
  return out;
}

function reportMarkdown(title, fns, loc) {
  var h = healthScore(fns), hs = hotspots(fns, 8);
  var lines = ['# Code health report: ' + title, '', '**Grade ' + h.grade + '** (' + h.score + '/100) · ' + fns.length + ' functions · ' + loc + ' lines', '', '## Score breakdown', ''];
  h.breakdown.forEach(function (p) { lines.push('- ' + p[0] + ': ' + p[1] + '/' + p[2]); });
  lines.push('', '## Hotspots', '', '| Function | File | CC | LOC |', '|---|---|---|---|');
  hs.forEach(function (f) { lines.push('| `' + f.name + '` | ' + (f.file || '') + ' | ' + f.cc + ' | ' + f.loc + ' |'); });
  var issueRows = fns.filter(function (f) { return (f.issues || []).length; });
  if (issueRows.length) {
    lines.push('', '## Issues', '');
    issueRows.forEach(function (f) { lines.push('- `' + f.name + '`' + (f.file ? ' (' + f.file + ')' : '') + ': ' + f.issues.map(function (i) { return i[1]; }).join(', ')); });
  }
  return lines.join('\n') + '\n';
}
