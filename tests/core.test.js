const SRC = `
export function grade(score) {
  if (score > 90) return 'A';
  else if (score > 80) return 'B';
  else if (score > 70 && score < 75) return 'C';
  return 'F';
}
const twice = (x) => helper(x) * 2;
function helper(x) { for (const i of [1, 2]) { if (i && x) { while (x > 0) x--; } } return x; }
function unused() { return 1; }
class Box { open() { return twice(1); } }
`;

test('analyze finds declarations, arrows and class methods', () => {
  const m = analyze(SRC);
  const names = m.fns.map((f) => f.name).sort();
  assert.deepEq(names, ['Box.open', 'grade', 'helper', 'twice', 'unused']);
});

test('cyclomatic complexity counts branches and logical operators', () => {
  const m = analyze(SRC);
  const cc = Object.fromEntries(m.fns.map((f) => [f.name, f.cc]));
  assert.eq(cc.grade, 5, 'if + else-if + else-if + && = 1 + 4');
  assert.eq(cc.helper, 5, 'for-of + if + && + while');
  assert.eq(cc.unused, 1);
});

test('nesting depth ignores else-if chains', () => {
  const m = analyze(SRC);
  const d = Object.fromEntries(m.fns.map((f) => [f.name, f.maxDepth]));
  assert.eq(d.grade, 1);
  assert.eq(d.helper, 3);
});

test('call graph resolves direct and method calls; dead code is flagged', () => {
  const m = analyze(SRC);
  const by = Object.fromEntries(m.fns.map((f) => [f.name, f]));
  assert.ok([...by.twice.edges].includes(by.helper));
  assert.ok([...by['Box.open'].edges].includes(by.twice));
  assert.ok(by.unused.issues.some((i) => i[1] === 'never called'));
  assert.ok(!by.grade.issues.some((i) => i[1] === 'never called'), 'exported functions are not dead');
});

test('analyze throws on syntax errors', () => {
  assert.throws(() => analyze('function ( {'));
});

test('resolveImport handles ./, ../ and index files', () => {
  const names = ['src/a.js', 'src/lib/b.js', 'src/util/index.js'];
  assert.eq(resolveImport('src/a.js', './lib/b.js', names), 'src/lib/b.js');
  assert.eq(resolveImport('src/lib/b.js', '../a', names), 'src/a.js');
  assert.eq(resolveImport('src/a.js', './util', names), 'src/util/index.js');
  assert.eq(resolveImport('src/a.js', 'react', names), null);
});

test('analyzeProject builds the import graph and cross-file calls, and survives bad files', () => {
  const p = analyzeProject([
    { name: 'src/main.js', src: "import { total } from './math.js';\nexport function run() { return total([1, 2]); }" },
    { name: 'src/math.js', src: 'export function total(xs) { return xs.reduce((a, b) => a + b, 0); }' },
    { name: 'src/broken.js', src: 'function (' },
  ]);
  assert.deepEq(p.imports, [{ from: 'src/main.js', to: 'src/math.js' }]);
  assert.eq(p.crossCalls.length, 1);
  assert.eq(p.crossCalls[0].to, 'src/math.js:total');
  assert.eq(p.errors.length, 1);
  assert.eq(p.fns.find((f) => f.name === 'total').file, 'src/math.js');
});

test('histogram bins values and clamps outliers', () => {
  assert.deepEq(histogram([1, 2, 3, 9, 50], 4, 0, 12), [2, 1, 0, 2]);
});

test('healthScore grades simple code A and gnarly code lower', () => {
  const simple = analyze('export const a = (x) => x + 1;\nexport function b(y) { return y * 2; }').fns;
  assert.eq(healthScore(simple).grade, 'A');
  const gnarly = analyze('export function z(a,b,c,d,e){' + 'if(a&&b||c){'.repeat(8) + 'return 1' + '}'.repeat(8) + 'return 0}').fns;
  assert.ok(healthScore(gnarly).score < healthScore(simple).score);
  assert.eq(healthScore([]).score, 100);
});

test('hotspots rank by complexity weighted by size', () => {
  const fns = [{ name: 'a', cc: 2, loc: 100 }, { name: 'b', cc: 12, loc: 9 }, { name: 'c', cc: 8, loc: 64 }];
  assert.deepEq(hotspots(fns, 2).map((f) => f.name), ['c', 'b']);
});

test('snapshot + compareSnapshots report deltas', () => {
  const s1 = snapshot('v1', analyze(SRC).fns, 20);
  const s2 = snapshot('v2', analyze('export function only() { return 1; }').fns, 3);
  const d = compareSnapshots(s1, s2);
  assert.eq(d.fns, 1 - 5);
  assert.ok(d.avgCC < 0);
});

test('reportMarkdown includes grade, hotspots and issues', () => {
  const md = reportMarkdown('demo', analyze(SRC).fns, 20);
  assert.ok(md.startsWith('# Code health report: demo'));
  assert.ok(md.includes('## Hotspots') && md.includes('`grade`'));
  assert.ok(md.includes('never called'));
});
