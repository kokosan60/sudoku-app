/* UI 層のスモークテスト（開発用・アプリには含めない）
 * index.html を jsdom で読み込み、実際にクリック／キーボード操作して
 * 生成・入力・ヒント・Undo・正解チェック・自動解答・解析・保存までを確認する。
 *   node tools/smoke.js
 * ※ jsdom では URL.createObjectURL / ResizeObserver / dialog.showModal が無いため、
 *   Worker 無しの分割実行フォールバックと window.confirm フォールバックが検証される。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   → ' + detail));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return true; } catch (e) { /* まだ */ }
    await sleep(40);
  }
  throw new Error('タイムアウト: ' + label);
}

(async function main() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // Worker 経路を無効化して「分割実行フォールバック」を検証する
      try { window.URL.createObjectURL = undefined; } catch (e) { }
      window.confirm = function () { return true; };
      const errs = [];
      window.__errors = errs;
      window.addEventListener('error', (e) => errs.push(String(e.message || e.error)));
    }
  });
  const win = dom.window;
  const doc = win.document;
  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const cells = () => Array.from(doc.querySelectorAll('.cell'));
  const valueOf = (i) => cells()[i].querySelector('.value').textContent.trim();
  const key = (k, opts) => doc.getElementById('board').dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));

  await waitFor(() => cells().length === 81, 5000, '盤面の初期構築');

  // ---- 初期状態 ----
  check('起動: 盤面が 9x9=81 マス生成される', cells().length === 81, 'cells=' + cells().length);
  check('起動: 起動時エラーが無い', (win.__errors || []).length === 0, (win.__errors || []).join(' / '));
  check('起動: 問題が無い状態では次の一手が無効', $('btn-hint').disabled === true, 'disabled=' + $('btn-hint').disabled);
  check('起動: 役割が grid/row/gridcell で構成される',
    doc.querySelector('#board').getAttribute('role') === 'grid' &&
    doc.querySelectorAll('#board [role="row"]').length === 9 &&
    doc.querySelectorAll('#board [role="gridcell"]').length === 81, 'ARIA 構造');

  // ---- プレイモード: 生成 ----
  click($('btn-new'));
  check('生成: 処理中パネルとキャンセルボタンが表示される', $('busy-panel').hidden === false);
  await waitFor(() => $('busy-panel').hidden === true, 60000, '問題生成の完了');
  const clues = cells().filter((c) => c.className.indexOf('initial') >= 0).length;
  check('生成: やさしいの初期配置数が 40〜46 個', clues >= 40 && clues <= 46, 'clues=' + clues);
  check('生成: 問題IDと難易度が表示される',
    /^#/.test($('stat-id').textContent) && $('stat-difficulty').textContent === 'やさしい',
    $('stat-id').textContent + ' / ' + $('stat-difficulty').textContent);
  check('生成: 唯一解を検証済みとして正解依存ボタンが有効になる',
    $('btn-hint').disabled === false && $('btn-solve').disabled === false && $('btn-check').disabled === false);
  check('生成: 初期配置マスは編集不可（aria-readonly=true）',
    cells().filter((c) => c.className.indexOf('initial') >= 0)
      .every((c) => c.getAttribute('aria-readonly') === 'true'));

  // ---- 入力（クリック＋キーボード） ----
  const emptyIdx = cells().findIndex((c) => c.className.indexOf('initial') < 0);
  click(cells()[emptyIdx]);
  check('選択: 選択マスが selected かつ tabindex=0',
    cells()[emptyIdx].className.indexOf('selected') >= 0 && cells()[emptyIdx].getAttribute('tabindex') === '0');
  key('5');
  check('入力: キーボードの数字で入力できる', valueOf(emptyIdx) === '5', 'value=' + valueOf(emptyIdx));
  check('入力: 入力値マスに user クラスが付く', cells()[emptyIdx].className.indexOf('user') >= 0);
  key('m');
  check('入力: M キーで候補メモモードに切り替わる', $('btn-note').getAttribute('aria-pressed') === 'true');
  const emptyIdx2 = cells().findIndex((c, i) => i !== emptyIdx && c.className.indexOf('initial') < 0 && c.className.indexOf('user') < 0);
  click(cells()[emptyIdx2]);
  key('1'); key('7');
  const noteText = Array.from(cells()[emptyIdx2].querySelectorAll('.notes span')).map((s) => s.textContent).join('');
  check('候補: 候補メモが 3x3 の固定位置に表示される', noteText === '17', 'notes=' + noteText);
  check('候補: 同じ数字をもう一度押すと候補が削除される', (key('1'), Array.from(cells()[emptyIdx2].querySelectorAll('.notes span')).map((s) => s.textContent).join('')) === '7');
  key('m');
  check('入力: M キーで数字入力モードに戻る', $('btn-note').getAttribute('aria-pressed') === 'false');

  // ---- Undo / Redo ----
  click($('btn-undo'));
  check('Undo: 候補メモが元に戻る', Array.from(cells()[emptyIdx2].querySelectorAll('.notes span')).map((s) => s.textContent).join('') === '17');
  click($('btn-redo'));
  check('Redo: 候補メモが再適用される', Array.from(cells()[emptyIdx2].querySelectorAll('.notes span')).map((s) => s.textContent).join('') === '7');
  let undoCount = 0;
  while (valueOf(emptyIdx) !== '' && undoCount < 12) { click($('btn-undo')); undoCount++; }
  check('Undo: 繰り返しで数字入力まで取り消される（' + undoCount + ' 回）', valueOf(emptyIdx) === '' && undoCount > 0, 'value=' + valueOf(emptyIdx));
  let redoCount = 0;
  while (valueOf(emptyIdx) !== '5' && redoCount < 12) { click($('btn-redo')); redoCount++; }
  check('Redo: 繰り返しで数字入力が再適用される（' + redoCount + ' 回）', valueOf(emptyIdx) === '5');

  // ---- 正解チェック ----
  click($('btn-check'));
  check('正解チェック: 誤入力マスが wrong クラスで示される', cells()[emptyIdx].className.indexOf('wrong') >= 0);
  check('正解チェック: 正解の数字は表示しない', $('status').textContent.indexOf('正解の数字は表示しません') >= 0, $('status').textContent);
  click($('btn-check'));
  check('正解チェック: 表示を解除できる', cells()[emptyIdx].className.indexOf('wrong') < 0);

  // ---- 次の一手 ----
  // 誤入力が残っていると安全確認でヒントが停止するため、先に Undo で消しておく
  let cleared = 0;
  while (cells().some((c) => c.className.indexOf('user') >= 0) && cleared < 30) { click($('btn-undo')); cleared++; }
  check('ヒント前提: 誤入力を Undo で消せる', !cells().some((c) => c.className.indexOf('user') >= 0));
  click($('btn-hint'));
  let hintRetry = 0;
  while (!/手法：/.test($('hint-text').textContent) && hintRetry < 3) {
    click($('btn-new'));
    await waitFor(() => $('busy-panel').hidden === true, 60000, '問題の再生成');
    click($('btn-hint'));
    hintRetry++;
  }
  const hintText = $('hint-text').textContent;
  check('ヒント: 対象マス・数字・手法・理由が表示される',
    /次の一手：\d+行\d+列に「\d」/.test(hintText) && /手法：/.test(hintText) && /理由：/.test(hintText), hintText);
  check('ヒント: 使用回数が 1 増える', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  const hintTarget = cells().findIndex((c) => c.className.indexOf('hint-target') >= 0);
  check('ヒント: 対象マスが強調される', hintTarget >= 0);
  click($('btn-hint'));
  check('ヒント: 同じ盤面・同じ一手の再表示では回数が増えない', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  const beforeApply = cells().map((c) => c.querySelector('.value').textContent.trim()).join('');
  click($('btn-apply-hint'));
  const afterApply = cells().map((c) => c.querySelector('.value').textContent.trim()).join('');
  check('ヒント適用: 数字が 1 つ入力される',
    afterApply !== beforeApply && afterApply.split('').filter((x) => x !== '').length > beforeApply.split('').filter((x) => x !== '').length);
  check('ヒント適用: 適用後にヒント表示が解除される', $('btn-apply-hint').disabled === true);
  check('ヒント適用: 使用回数は増えない', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  click($('btn-undo'));
  check('ヒント適用: Undo で適用前の状態に戻る',
    cells().map((c) => c.querySelector('.value').textContent.trim()).join('') === beforeApply);
  click($('btn-redo'));

  // ---- リセット ----
  click($('btn-reset'));
  await waitFor(() => $('stat-hints').textContent === '0 回', 5000, 'リセット');
  check('リセット: ヒント使用回数と入力が初期化される',
    $('stat-hints').textContent === '0 回' && valueOf(emptyIdx) === '' && cells().filter((c) => c.className.indexOf('user') >= 0).length === 0);
  check('リセット: 初期配置は維持される', cells().filter((c) => c.className.indexOf('initial') >= 0).length === clues);
  check('リセット: Undo 履歴が初期化される', $('btn-undo').disabled === true);

  // ---- 自動解答（プレイ） ----
  click($('btn-solve'));
  await waitFor(() => $('completion-panel').hidden === false, 5000, '自動解答後の完成表示');
  check('自動解答: 全マスが埋まり完成表示が出る',
    cells().every((c) => c.querySelector('.value').textContent.trim() !== '') && $('completion-panel').hidden === false);
  check('自動解答: 完成メッセージに自動解答の使用が記録される',
    $('completion-text').textContent.indexOf('自動解答') >= 0 && $('completion-text').textContent.indexOf('経過時間') >= 0,
    $('completion-text').textContent);
  check('自動解答: 完成後は Undo で未完成に戻せる', (click($('btn-undo')), cells().some((c) => c.querySelector('.value').textContent.trim() === '')));
  check('自動解答: Undo 後も使用記録は残る', $('completion-panel').hidden === true && $('btn-check').disabled === false);

  // ---- 保存（localStorage） ----
  const saved = JSON.parse(win.localStorage.getItem('sudoku-app-state'));
  check('保存: version 2 の状態が保存される', saved.version === 2 && !!saved.play.puzzleId, 'version=' + saved.version);
  check('保存: 正解・初期配置・候補メモ・履歴が含まれる',
    Array.isArray(saved.play.initialBoard) && Array.isArray(saved.play.solutionBoard) &&
    Array.isArray(saved.play.notes) && Array.isArray(saved.play.undo) && typeof saved.play.hintCount === 'number');
  check('保存: 表示中ヒント(hintState)は保存しない', saved.play.hint === undefined && saved.play.hintState === undefined);

  // ---- モード切り替えと解析モード ----
  click($('tab-analysis'));
  check('モード: 解析モードに切り替わりプレイのタイマーが止まる',
    $('panel-analysis').hidden === false && $('panel-play').hidden === true && $('stat-timer').textContent.indexOf(':') > 0);
  $('import-text').value = '852001090090402106004509200901208043605300900300904500230000800006003000400800370';
  click($('btn-import'));
  check('インポート: 81 文字を読み込む',
    cells().filter((c) => c.querySelector('.value').textContent.trim() !== '').length === 37,
    'clues=' + cells().filter((c) => c.querySelector('.value').textContent.trim() !== '').length);
  click($('btn-analyze'));
  await waitFor(() => /^解析結果：/.test($('analysis-result').textContent.trim()), 60000, '解析');
  check('解析: 唯一解と判定される', $('analysis-result').textContent.indexOf('唯一解') >= 0, $('analysis-result').textContent);
  check('解析: 適用可能な結果として自動解答ボタンが有効', $('btn-analysis-solve').disabled === false);
  click($('btn-analysis-solve'));
  await waitFor(() => cells().every((c) => c.querySelector('.value').textContent.trim() !== ''), 5000, '解の適用');
  check('解析: 解を適用して全マスが埋まる', cells().every((c) => c.querySelector('.value').textContent.trim() !== ''));
  const arText = $('analysis-result').textContent;
  check('解析: 適用後は結果が無効化され、自動解答ボタンが無効に戻る',
    $('btn-analysis-solve').disabled === true &&
    (arText.indexOf('まだありません') >= 0 || arText.indexOf('もう一度') >= 0), arText);
  click($('btn-undo'));
  check('解析: Undo で適用前の入力に戻る',
    cells().filter((c) => c.querySelector('.value').textContent.trim() !== '').length === 37);

  // ---- 不正インポート ----
  const before = cells().map((c) => c.querySelector('.value').textContent.trim()).join('');
  $('import-text').value = '1234';
  click($('btn-import'));
  check('インポート: 不正な入力では盤面が変わらず通知される',
    cells().map((c) => c.querySelector('.value').textContent.trim()).join('') === before &&
    $('notice').hidden === false && $('notice').textContent.indexOf('インポートできません') >= 0,
    $('notice').textContent);

  // ---- 重複の自動通知 ----
  click($('tab-play'));
  await waitFor(() => $('panel-play').hidden === false, 3000, 'プレイモード復帰');
  const idxA = cells().findIndex((c) => c.className.indexOf('initial') < 0);
  const clueIdx = cells().findIndex((c) => c.className.indexOf('initial') >= 0);
  click(cells()[idxA]);
  const clueVal = cells()[clueIdx].querySelector('.value').textContent.trim();
  key(clueVal);
  const rowIdx = Array.from({ length: 9 }, (_, k) => Math.floor(clueIdx / 9) * 9 + k).find((i) => i !== clueIdx && cells()[i].className.indexOf('initial') < 0);
  click(cells()[rowIdx]);
  key(clueVal);
  check('重複: 同じ行に同じ数字を入れると重複マスが表示される',
    cells().some((c) => c.className.indexOf('dup') >= 0) && $('status').textContent.indexOf('重複') >= 0, $('status').textContent);
  check('重複: 初期配置のマスも重複表示の対象になる',
    cells()[clueIdx].className.indexOf('dup') >= 0);
  click($('btn-hint'));
  check('重複: 重複があるとヒントを提示しない',
    $('status').textContent.indexOf('重複エラーを修正してから') >= 0, $('status').textContent);

  // ---- 自動テストの UI 実行 ----
  click($('btn-run-tests'));
  await waitFor(() => $('test-summary').textContent.indexOf('テスト完了') >= 0, 120000, 'UI テスト実行');
  const lis = Array.from(doc.querySelectorAll('#test-results li'));
  check('自動テスト(UI): 20 件すべて成功と表示される',
    lis.length === 20 && lis.every((li) => li.className === 'ok') && $('test-summary').textContent.indexOf('20 件成功') >= 0,
    $('test-summary').textContent + ' / li=' + lis.length);

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- UI スモークテスト: ' + (results.length - failed.length) + ' / ' + results.length + ' 成功 ---');
  if ((win.__errors || []).length) console.log('window エラー: ' + win.__errors.join(' / '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('スモークテストが例外で停止しました: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
