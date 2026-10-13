/* UI 層のスモークテスト（開発用・アプリには含めない）
 * index.html を jsdom で読み込み、実際にクリック／キーボード操作して
 * 「共有盤面モデル（プレイ／入力・解析で盤面・候補メモ・履歴を共有）」を確認する。
 *   node tools/smoke.js
 * ※ jsdom では URL.createObjectURL / ResizeObserver が無いため、
 *   Worker 無しの分割実行フォールバックが検証される。
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
  const values = () => cells().map((c) => c.querySelector('.value').textContent.trim()).join('|');
  const notesOf = (i) => Array.from(cells()[i].querySelectorAll('.notes span')).map((s) => s.textContent).join('');
  const key = (k, opts) => doc.getElementById('board').dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
  // <dialog> による確認が表示された場合は OK を押す（jsdom の実装差を吸収する）
  const confirmIfShown = () => { const d = $('confirm-dialog'); if (d && d.open) { click($('confirm-ok')); return true; } return false; };

  await waitFor(() => cells().length === 81, 5000, '盤面の初期構築');

  /* ---------------------------------------------------------------- 起動 */
  check('起動: 盤面が 9x9=81 マス生成される', cells().length === 81, 'cells=' + cells().length);
  check('起動: 起動時エラーが無い', (win.__errors || []).length === 0, (win.__errors || []).join(' / '));
  check('起動: 空の盤面でも「次の一手」は論理判定のみで押せる（正解依存は無効）',
    $('btn-hint').disabled === false && $('btn-check').disabled === true && $('btn-solve').disabled === true,
    'hint=' + $('btn-hint').disabled + ' / check=' + $('btn-check').disabled + ' / solve=' + $('btn-solve').disabled);
  check('起動: 役割が grid/row/gridcell で構成される',
    doc.querySelector('#board').getAttribute('role') === 'grid' &&
    doc.querySelectorAll('#board [role="row"]').length === 9 &&
    doc.querySelectorAll('#board [role="gridcell"]').length === 81, 'ARIA 構造');
  check('起動: 共有盤面の説明が DOM に存在する', !!$('shared-note'), 'shared-note=' + !!$('shared-note'));

  /* ------------------------------------------- 自動テスト機能の削除の確認 */
  check('自動テスト: 実行ボタンが削除されている', $('btn-run-tests') === null);
  check('自動テスト: 結果一覧の要素が削除されている', $('test-results') === null && $('test-summary') === null);
  check('自動テスト: テスト用スクリプトが index.html に含まれない',
    html.indexOf('sudoku-tests') < 0 && html.indexOf('SudokuTests') < 0);

  /* ---------------------------------------------------- プレイモード生成 */
  click($('btn-new'));
  check('生成: 処理中パネルが表示される', $('busy-panel').hidden === false);
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

  /* -------------------------------------------------------- 入力と候補メモ */
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
  check('候補: 候補メモが 3x3 の固定位置に表示される', notesOf(emptyIdx2) === '17', 'notes=' + notesOf(emptyIdx2));
  check('候補: 同じ数字をもう一度押すと候補が削除される', (key('1'), notesOf(emptyIdx2)) === '7');
  key('m');
  check('入力: M キーで数字入力モードに戻る', $('btn-note').getAttribute('aria-pressed') === 'false');

  /* ------------------------------------------------------------ Undo/Redo */
  click($('btn-undo'));
  check('Undo: 候補メモが元に戻る', notesOf(emptyIdx2) === '17');
  click($('btn-redo'));
  check('Redo: 候補メモが再適用される', notesOf(emptyIdx2) === '7');
  let undoCount = 0;
  while (valueOf(emptyIdx) !== '' && undoCount < 12) { click($('btn-undo')); undoCount++; }
  check('Undo: 繰り返しで数字入力まで取り消される（' + undoCount + ' 回）', valueOf(emptyIdx) === '' && undoCount > 0, 'value=' + valueOf(emptyIdx));
  let redoCount = 0;
  while (valueOf(emptyIdx) !== '5' && redoCount < 12) { click($('btn-redo')); redoCount++; }
  check('Redo: 繰り返しで数字入力が再適用される（' + redoCount + ' 回）', valueOf(emptyIdx) === '5');

  /* ------------------------------------------------------------ 正解チェック */
  /* ------------------------------------------------------------ 正解チェック */
  // 直前のテストで入れた値を消し、重複の無い盤面から「重複しない数字」だけで判定する
  let preClear = 0;
  while (cells().some((c) => c.className.indexOf('user') >= 0) && preClear < 30) { click($('btn-undo')); preClear++; }
  const usedDigits = (idx) => {
    const r = Math.floor(idx / 9), c = idx % 9, used = {};
    for (let k = 0; k < 9; k++) {
      used[valueOf(r * 9 + k)] = true;
      used[valueOf(k * 9 + c)] = true;
      used[valueOf((Math.floor(r / 3) * 3 + Math.floor(k / 3)) * 9 + (Math.floor(c / 3) * 3) + (k % 3))] = true;
    }
    return used;
  };
  const freeOf = (idx) => ['1', '2', '3', '4', '5', '6', '7', '8', '9'].filter((d) => !usedDigits(idx)[d]);
  const checkIdx = cells().map((c, i) => i)
    .filter((i) => cells()[i].className.indexOf('initial') < 0)
    .find((i) => freeOf(i).length >= 2);
  check('正解チェックの前提: 重複しない数字が 2 つ以上ある空きマスがある', checkIdx !== undefined, 'checkIdx=' + checkIdx);
  const freeDigits = freeOf(checkIdx);
  click($('btn-check'));
  const wrongList = [], correctList = [];
  for (const d of freeDigits) {
    click(cells()[checkIdx]); key(d);
    (cells()[checkIdx].className.indexOf('wrong') >= 0 ? wrongList : correctList).push(d);
  }
  check('正解チェック: 誤入力マスが wrong クラスで示される', wrongList.length > 0,
    'free=' + freeDigits.join('') + ' / wrong=' + wrongList.join('') + ' / correct=' + correctList.join(''));
  check('正解チェック: 重複しない数字のうち正解は 1 つだけ', correctList.length === 1,
    'correct=' + correctList.join(''));
  click(cells()[checkIdx]);
  key(wrongList.length ? wrongList[0] : freeDigits[0]);
  click($('btn-check')); click($('btn-check'));                       // OFF→ON で判定メッセージを出させる
  check('正解チェック: 誤りがある場合は正解の数字を表示しない',
    $('status').textContent.indexOf('正解の数字は表示しません') >= 0, $('status').textContent);
  click($('btn-check'));
  check('正解チェック: 表示を解除できる', cells()[checkIdx].className.indexOf('wrong') < 0);

  /* --------------------------------------------------------------- 重複通知 */
  const clueIdx = cells().findIndex((c) => c.className.indexOf('initial') >= 0);
  const clueVal = valueOf(clueIdx);
  const rowIdx = Array.from({ length: 9 }, (_, k) => Math.floor(clueIdx / 9) * 9 + k).find((i) => i !== clueIdx && cells()[i].className.indexOf('initial') < 0);
  click(cells()[rowIdx]);
  key('Delete');                                                  // 直前のテストの入力が残っている場合は消してから入れる
  key(clueVal);
  check('重複: 同じ行に同じ数字を入れると重複マスが表示される',
    cells().some((c) => c.className.indexOf('dup') >= 0) && $('status').textContent.indexOf('重複') >= 0, $('status').textContent);
  check('重複: 初期配置のマスも重複表示の対象になる', cells()[clueIdx].className.indexOf('dup') >= 0);
  click($('btn-hint'));
  check('重複: 重複があるとヒントを提示しない', $('status').textContent.indexOf('重複エラーを修正してから') >= 0, $('status').textContent);

  // 誤入力が残っているとヒントの安全確認で止まるため、Undo で消しておく
  let cleared = 0;
  while (cells().some((c) => c.className.indexOf('user') >= 0) && cleared < 30) { click($('btn-undo')); cleared++; }
  check('ヒント前提: 誤入力を Undo で消せる', !cells().some((c) => c.className.indexOf('user') >= 0));

  /* -------------------------------------------------------------- 次の一手 */
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
  check('ヒント: 正解データがある場合は照合済みの注記が出ない',
    $('status').textContent.indexOf('正解データが無いため') < 0, $('status').textContent);
  check('ヒント: 使用回数が 1 増える', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  check('ヒント: 対象マスが強調される', cells().some((c) => c.className.indexOf('hint-target') >= 0));
  click($('btn-hint'));
  check('ヒント: 同じ盤面・同じ一手の再表示では回数が増えない', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  const beforeApply = values();
  click($('btn-apply-hint'));
  const afterApply = values();
  check('ヒント適用: 数字が 1 つ入力される',
    afterApply !== beforeApply && afterApply.split('|').filter((x) => x !== '').length > beforeApply.split('|').filter((x) => x !== '').length);
  check('ヒント適用: 適用後にヒント表示が解除される', $('btn-apply-hint').disabled === true);
  click($('btn-undo'));
  check('ヒント適用: Undo で適用前の状態に戻る', values() === beforeApply);
  click($('btn-redo'));

  /* ---------------------------------------------------------------- リセット */
  click($('btn-reset'));
  await waitFor(() => $('stat-hints').textContent === '0 回', 5000, 'リセット');
  check('リセット: ヒント使用回数と入力が初期化される',
    $('stat-hints').textContent === '0 回' && !cells().some((c) => c.className.indexOf('user') >= 0));
  check('リセット: 初期配置は維持される', cells().filter((c) => c.className.indexOf('initial') >= 0).length === clues);
  check('リセット: Undo 履歴が初期化される', $('btn-undo').disabled === true);

  /* ------------------------------------------------------------ 自動解答（プレイ） */
  click($('btn-solve'));
  await waitFor(() => $('completion-panel').hidden === false, 5000, '自動解答後の完成表示');
  check('自動解答: 全マスが埋まり完成表示が出る',
    cells().every((c) => c.querySelector('.value').textContent.trim() !== '') && $('completion-panel').hidden === false);
  check('自動解答: 完成メッセージに自動解答の使用が記録される',
    $('completion-text').textContent.indexOf('自動解答') >= 0 && $('completion-text').textContent.indexOf('経過時間') >= 0,
    $('completion-text').textContent);
  check('自動解答: 完成後は Undo で未完成に戻せる', (click($('btn-undo')), cells().some((c) => c.querySelector('.value').textContent.trim() === '')));
  check('自動解答: Undo 後も使用記録は残る', $('completion-panel').hidden === true && $('btn-check').disabled === false);

  /* -------------------------------------------- 盤面の共有（プレイ→解析→プレイ） */
  // 共有履歴を確認するため、プレイモードで 1 手入力しておく
  const shareIdx = cells().findIndex((c) => c.querySelector('.value').textContent.trim() === '');
  const rowUsed = {};
  for (let k = 0; k < 9; k++) rowUsed[valueOf(Math.floor(shareIdx / 9) * 9 + k)] = true;
  const shareDigit = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find((d) => !rowUsed[d]);
  click(cells()[shareIdx]);
  key(shareDigit);
  check('共有の前提: プレイモードで 1 手入力できる', valueOf(shareIdx) === shareDigit, 'value=' + valueOf(shareIdx));
  const shared1 = values();
  click($('tab-analysis'));
  check('共有: 解析モードへ切り替わりプレイのタイマーが止まる',
    $('panel-analysis').hidden === false && $('panel-play').hidden === true && $('stat-timer').textContent.indexOf(':') > 0);
  check('共有: モードを切り替えても盤面が変わらない', values() === shared1);
  check('共有: 共有盤面の説明が解析モード向けに表示される',
    $('shared-note').textContent.indexOf('プレイモードと共有') >= 0, $('shared-note').textContent);
  check('共有: 履歴も共有される（解析モードでも Undo が使える）', $('btn-undo').disabled === false);
  click($('btn-undo'));
  check('共有: 解析モードでの Undo が盤面に反映される', values() !== shared1 && valueOf(shareIdx) === '');
  click($('btn-redo'));
  check('共有: Redo で元の盤面に戻る', values() === shared1);
  click($('tab-play'));
  check('共有: プレイモードに戻っても盤面は同じ',
    $('panel-play').hidden === false && values() === shared1 && valueOf(shareIdx) === shareDigit);
  check('共有: プレイモード向けの説明に切り替わる',
    $('shared-note').textContent.indexOf('入力・解析モードと共有') >= 0, $('shared-note').textContent);

  /* ------------------------------------------------------- インポートと解析 */
  click($('tab-analysis'));
  const NAKED = '852001090090402106004509200901208043605300900300904500230000800006003000400800370';
  const filledCount = () => cells().filter((c) => c.querySelector('.value').textContent.trim() !== '').length;
  $('import-text').value = NAKED;
  click($('btn-import'));
  await waitFor(() => { confirmIfShown(); return filledCount() === 37; }, 10000, 'インポートの反映');
  check('インポート: 81 文字を読み込む（既存の盤面を上書き）', filledCount() === 37, 'clues=' + filledCount());
  check('インポート: インポートした旨が通知される',
    $('status').textContent.indexOf('インポートしました') >= 0, $('status').textContent);
  check('インポート: 正解データ依存のボタンは無効のまま', $('btn-check').disabled === true && $('btn-solve').disabled === true);
  click($('btn-analyze'));
  await waitFor(() => /^解析結果：/.test($('analysis-result').textContent.trim()), 60000, '解析');
  check('解析: 唯一解と判定される', $('analysis-result').textContent.indexOf('唯一解') >= 0, $('analysis-result').textContent);
  check('解析: 適用可能な結果として自動解答ボタンが有効', $('btn-analysis-solve').disabled === false);
  check('採用: 唯一解の解析結果で採用ボタンが有効になる', $('btn-adopt').disabled === false);
  click($('btn-analysis-solve'));
  await waitFor(() => cells().every((c) => c.querySelector('.value').textContent.trim() !== ''), 5000, '解の適用');
  check('解析: 解を適用して全マスが埋まる', cells().every((c) => c.querySelector('.value').textContent.trim() !== ''));
  check('採用: 盤面が変わると採用ボタンと自動解答ボタンが無効になる',
    $('btn-adopt').disabled === true && $('btn-analysis-solve').disabled === true);
  click($('btn-undo'));
  check('解析: Undo で適用前の入力に戻る', filledCount() === 37, 'clues=' + filledCount());
  check('採用: 盤面が変わると解析結果が破棄され採用ボタンも無効になる', $('btn-adopt').disabled === true);
  click($('btn-analyze'));
  await waitFor(() => /^解析結果：/.test($('analysis-result').textContent.trim()) && $('btn-adopt').disabled === false, 60000, '再解析後の採用ボタン');
  check('採用: 再解析で採用ボタンが再び有効になる', $('btn-adopt').disabled === false);

  /* ------------------------------------------------- 入力盤面のプレイ問題への採用 */
  click($('btn-adopt'));
  await waitFor(() => { confirmIfShown(); return $('stat-difficulty').textContent === '採用した盤面'; }, 10000, '採用の反映');
  check('採用: プレイモードに切り替わる', $('panel-play').hidden === false && $('panel-analysis').hidden === true);
  check('採用: 難易度が「採用した盤面」になる', $('stat-difficulty').textContent === '採用した盤面');
  check('採用: 正解依存ボタンが有効になる',
    $('btn-check').disabled === false && $('btn-solve').disabled === false && $('btn-hint').disabled === false);
  check('採用: 履歴とカウンタがリセットされる',
    $('btn-undo').disabled === true && $('btn-redo').disabled === true && $('stat-hints').textContent === '0 回');
  check('採用: 盤面は入力した内容のまま引き継がれる', values().split('|').filter((x) => x !== '').length === 37);
  click($('btn-check'));
  check('採用: 正解チェックが機能する（誤りが無いので wrong は付かない）',
    !cells().some((c) => c.className.indexOf('wrong') >= 0), $('status').textContent);
  click($('btn-check'));

  /* -------------------------------------------- 初期配置の変更による対応付け解除 */
  click($('tab-analysis'));
  click(cells()[0]);
  const v0 = valueOf(0);
  key('7');
  check('解除: 盤面の入力はそのまま残る', valueOf(0) === '7' && v0 !== '7', 'value=' + valueOf(0));
  click($('tab-play'));
  check('解除: 初期配置を変更すると正解データ依存のボタンが無効になる',
    $('btn-check').disabled === true && $('btn-solve').disabled === true,
    'check=' + $('btn-check').disabled + ' / solve=' + $('btn-solve').disabled);
  check('解除: 「次の一手」は論理判定のみで使える', $('btn-hint').disabled === false);

  /* --------------------------------------------- 正解データ無しでの論理ヒント */
  // 別の唯一解の問題（隠れたシングルで解ける）を読み込み、正解データが無くても論理ヒントが出ることを確認する
  click($('tab-analysis'));
  const HIDDEN = '000400007143008000078006400010800040039000602004207000000049000050780960000000008';
  const hiddenClues = HIDDEN.split('').filter((ch) => ch !== '0').length;
  $('import-text').value = HIDDEN;
  click($('btn-import'));
  await waitFor(() => { confirmIfShown(); return filledCount() === hiddenClues; }, 10000, '2 件目のインポート');
  check('ヒント(正解なし)の前提: 正解データの無い盤面を用意できる',
    filledCount() === hiddenClues && $('btn-check').disabled === true, 'clues=' + filledCount());
  click($('tab-play'));
  click($('btn-hint'));
  check('ヒント(正解なし): 論理判定で一手を提示する',
    /次の一手：\d+行\d+列に「\d」/.test($('hint-text').textContent) && /手法：/.test($('hint-text').textContent),
    $('hint-text').textContent);
  check('ヒント(正解なし): 正解と照合していない旨が表示される',
    $('status').textContent.indexOf('正解データが無いため') >= 0, $('status').textContent);
  check('ヒント(正解なし): 使用回数が 1 増える', $('stat-hints').textContent === '1 回', $('stat-hints').textContent);
  check('ヒント(正解なし): 提示された一手を入力できる',
    (click($('btn-apply-hint')), $('btn-apply-hint').disabled === true));

  /* ------------------------------------------------------------ 不正インポート */
  click($('tab-analysis'));
  const beforeBad = values();
  $('import-text').value = '1234';
  click($('btn-import'));
  check('インポート: 不正な入力では盤面が変わらず通知される',
    values() === beforeBad && $('notice').hidden === false && $('notice').textContent.indexOf('インポートできません') >= 0,
    $('notice').textContent);

  /* ------------------------------------------------------------ 保存内容の確認 */
  const saved = JSON.parse(win.localStorage.getItem('sudoku-app-state'));
  check('保存: version 3 の状態が保存される', saved.version === 3, 'version=' + saved.version);
  check('保存: 共有盤面（board/notes/undo/redo/mode）が保存される',
    Array.isArray(saved.board) && Array.isArray(saved.notes) && Array.isArray(saved.undo) &&
    Array.isArray(saved.redo) && typeof saved.mode === 'string');
  check('保存: プレイ固有のメタ情報が保存される',
    ('initialBoard' in saved.play) && ('solutionBoard' in saved.play) && ('puzzleId' in saved.play) &&
    typeof saved.play.hintCount === 'number' && typeof saved.play.difficulty === 'string' &&
    Array.isArray(saved.play.revealedHintKeys) && typeof saved.play.autoSolved === 'boolean');
  check('保存: 表示中ヒント(hintState)は保存しない',
    saved.play.hint === undefined && saved.play.hintState === undefined && saved.hint === undefined);
  check('保存: 未検証の解析結果は保存しない',
    saved.analysis.result === null || saved.analysis.result.verified === true,
    JSON.stringify(saved.analysis));

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- UI スモークテスト: ' + (results.length - failed.length) + ' / ' + results.length + ' 成功 ---');
  if ((win.__errors || []).length) console.log('window エラー: ' + win.__errors.join(' / '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('スモークテストが例外で停止しました: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
