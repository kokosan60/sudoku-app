/* Node 用のテストランナー（開発用・アプリには含めない）
 * index.html から計算ロジックを抜き出し、tools/tests.js のテストを実行する。
 *   node tools/run-tests.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function extract(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>');
  const m = html.match(re);
  if (!m) throw new Error('script #' + id + ' が見つかりません（index.html の構成が変わった可能性があります）');
  return m[1];
}

const core = extract('sudoku-core');
const tests = fs.readFileSync(path.join(__dirname, 'tests.js'), 'utf8');

const ctx = {
  console, Date, Math, performance: { now: () => Date.now() },
  Int8Array, Int32Array, Array, Object, JSON, Error, String, Number,
  isFinite, parseInt, setTimeout
};
vm.createContext(ctx);
vm.runInContext(core, ctx);
vm.runInContext(tests, ctx);

const out = ctx.SudokuTests.run();
for (const r of out.results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  [' + String(r.ms).padStart(6) + 'ms]  ' + r.name + (r.slow ? '  (slow)' : ''));
  if (!r.pass) console.log('      → ' + r.detail.replace(/\n/g, '\n        '));
}
console.log('\n合計 ' + out.total + ' 件 / 成功 ' + out.passed + ' / 失敗 ' + out.failed + ' / ' + out.ms + 'ms');
process.exit(out.failed === 0 ? 0 : 1);
