/* 実ブラウザ（Playwright / Chromium）での自動操作テスト（開発用・アプリには含めない）
 *   node tools/browser-test.js
 * jsdom では検証できない次の点を確認する。
 *   ・Web Worker 経路（http で配信したとき）と、file:// での分割実行フォールバック
 *   ・実キーボード操作（クリックせずに数字入力できるか、Ctrl+Z、M キー）
 *   ・実際のレイアウト（横スクロールの有無、PC 幅／スマホ幅での操作）
 *   ・<dialog> による確認、リロード後の localStorage 復元
 * スクリーンショットの保存先は環境変数 SHOT_DIR（未指定なら一時ディレクトリ）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const INDEX = path.join(__dirname, '..', 'index.html');
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'sudoku-browser-test');
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   → ' + detail));
}

/** index.html だけを配信する簡易サーバー（http で Worker を使えるようにするため）。 */
function startServer() {
  const body = fs.readFileSync(INDEX);
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p !== '/' && p !== '/index.html') { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/** ページを準備する（エラー収集・Worker 利用の記録・ダイアログ自動 OK）。 */
async function openPage(browser, url, contextOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, contextOpts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__workerCtor = 0;
    const Orig = window.Worker;
    if (Orig) {
      function W(...args) { window.__workerCtor++; return new Orig(...args); }
      W.prototype = Orig.prototype;
      window.Worker = W;
    }
  });
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, errors };
}

const values = (page) => page.$$eval('#board .cell .value', (els) => els.map((e) => e.textContent.trim()));
const filled = (page) => page.$$eval('#board .cell .value', (els) => els.filter((e) => e.textContent.trim() !== '').length);
const userCells = (page) => page.$$eval('#board .cell', (els) => els.filter((e) => e.className.indexOf('user') >= 0).length);
const waitIdle = (page, timeout) => page.waitForFunction(() => document.getElementById('busy-panel').hidden === true, { timeout: timeout || 90000 });
/** <dialog> の確認が表示されたら OK を押す。 */
async function confirmIfShown(page) {
  const dlg = await page.$('#confirm-dialog[open]');
  if (dlg) { await page.click('#confirm-ok'); return true; }
  return false;
}
async function confirmLoop(page, fn) {
  await confirmIfShown(page);
  return fn();
}

(async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const { srv, port } = await startServer();
  const browser = await chromium.launch();
  const httpUrl = 'http://127.0.0.1:' + port + '/';

  /* ================================ A. http 配信（Web Worker 経路） ================================ */
  {
    const { ctx, page, errors } = await openPage(browser, httpUrl);
    await page.waitForSelector('#board .cell');
    check('A-起動: 81 マスが描画される',
      (await page.$$eval('#board .cell', (e) => e.length)) === 81);
    check('A-起動: 起動時エラーが無い', errors.length === 0, errors.join(' / '));
    check('A-起動: キーボード入力先のマスが自動で選択される（activeElement が盤面のマス）',
      await page.evaluate(() => document.activeElement && document.activeElement.className.indexOf('cell') >= 0),
      await page.evaluate(() => document.activeElement && document.activeElement.className));
    check('A-起動: Web Worker が利用可能な環境である',
      await page.evaluate(() => typeof Worker === 'function'));
    check('A-キーボード(PC): ソフトキーボード用の隠し入力欄ではなく、盤面のマスにフォーカスする',
      await page.evaluate(() => document.activeElement.id !== 'cell-key-input'),
      await page.evaluate(() => document.activeElement && document.activeElement.id));

    /* --- 生成（Worker 経路で実行されるはず） --- */
    await page.click('#btn-new');
    await waitIdle(page);
    const clues = await page.$$eval('#board .cell.initial', (e) => e.length);
    check('A-生成: やさしいの初期配置数が 40〜46 個', clues >= 40 && clues <= 46, 'clues=' + clues);
    check('A-生成: Worker 経由で処理が実行された',
      (await page.evaluate(() => window.__workerCtor)) > 0,
      'Worker 生成回数=' + (await page.evaluate(() => window.__workerCtor)));
    check('A-生成: 唯一解の検証が完了して正解依存ボタンが有効になる',
      (await page.evaluate(() => !document.getElementById('btn-check').disabled)) &&
      (await page.evaluate(() => !document.getElementById('btn-solve').disabled)));
    check('A-生成: 起動時エラーが無い', errors.length === 0, errors.join(' / '));

    /* --- 実キーボード操作（クリックせずに入力） --- */
    await page.keyboard.press('5');
    check('A-キーボード: クリックせずに数字キーで入力できる',
      (await userCells(page)) === 1 && (await values(page)).includes('5'),
      'user=' + (await userCells(page)) + ' / status=' + (await page.textContent('#status')));
    await page.keyboard.press('Backspace');
    check('A-キーボード: Backspace で消去できる', (await userCells(page)) === 0);
    await page.keyboard.press('m');
    check('A-キーボード: M キーで候補メモモードに切り替わる',
      (await page.getAttribute('#btn-note', 'aria-pressed')) === 'true');
    await page.keyboard.press('3'); await page.keyboard.press('8');
    check('A-キーボード: 候補メモを 2 つ入力できる',
      (await page.$$eval('#board .cell.selected .notes span', (els) => els.map((e) => e.textContent).join(''))) === '38',
      await page.$$eval('#board .cell.selected .notes span', (els) => els.map((e) => e.textContent).join('')));
    await page.keyboard.press('m');
    check('A-キーボード: M キーで数字入力モードに戻る',
      (await page.getAttribute('#btn-note', 'aria-pressed')) === 'false');
    await page.keyboard.press('Control+z');
    check('A-キーボード: Ctrl+Z で Undo できる',
      (await page.$$eval('#board .cell.selected .notes span', (els) => els.map((e) => e.textContent).join(''))) === '3');
    await page.keyboard.press('Control+Shift+z');
    check('A-キーボード: Ctrl+Shift+Z で Redo できる',
      (await page.$$eval('#board .cell.selected .notes span', (els) => els.map((e) => e.textContent).join(''))) === '38');
    // 候補メモを消して数字入力の検証に戻す
    await page.keyboard.press('m'); await page.keyboard.press('0'); await page.keyboard.press('m');
    await page.keyboard.press('7');
    const afterTyping = await values(page);
    // ※ 解析モードでは全マスが編集可能になり、クラス user は「空でない編集可能マス」にも付く。
    //    そのため「どのマスに入れたか」はプレイモードのうちに位置で覚えておく。
    const typedIdx = await page.$$eval('#board .cell', (els) => els.findIndex((e) => e.className.indexOf('user') >= 0));
    check('A-入力: 入力したマスの位置を特定できる（プレイモードでは user クラスが入力値に付く）',
      typedIdx >= 0 && afterTyping[typedIdx] === '7', 'idx=' + typedIdx + ' value=' + afterTyping[typedIdx]);

    /* --- モード共有（実ブラウザでの DOM 比較） --- */
    await page.click('#tab-analysis');
    check('A-共有: 解析モードに切り替えても盤面が変わらない',
      JSON.stringify(await values(page)) === JSON.stringify(afterTyping));
    check('A-共有: 解析モードでも共有の説明が表示される',
      (await page.textContent('#shared-note')).indexOf('プレイモードと共有') >= 0);
    await page.keyboard.press('Control+z');
    check('A-共有: 解析モードの Ctrl+Z がプレイモードで入れた数字を取り消す',
      (await values(page))[typedIdx] === '', 'value=' + (await values(page))[typedIdx]);
    await page.keyboard.press('Control+Shift+z');
    check('A-共有: Redo で元に戻る', JSON.stringify(await values(page)) === JSON.stringify(afterTyping));
    await page.click('#tab-play');
    check('A-共有: プレイモードに戻っても盤面は同じ',
      JSON.stringify(await values(page)) === JSON.stringify(afterTyping));

    /* --- リロード後の復元（localStorage） --- */
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#board .cell');
    await page.waitForFunction(() => !document.getElementById('btn-check').disabled, { timeout: 30000 });
    check('A-保存: リロード後も盤面が復元される',
      JSON.stringify(await values(page)) === JSON.stringify(afterTyping));
    check('A-保存: 保存形式が version 3',
      (await page.evaluate(() => JSON.parse(localStorage.getItem('sudoku-app-state')).version)) === 3);
    check('A-保存: 復元後の再検証が完了して正解依存ボタンが有効になる',
      await page.evaluate(() => !document.getElementById('btn-check').disabled));

    /* --- 解析 → 採用（<dialog> の確認を含む） --- */
    await page.click('#tab-analysis');
    await page.fill('#import-text', '852001090090402106004509200901208043605300900300904500230000800006003000400800370');
    await page.click('#btn-import');
    const okShown = await confirmIfShown(page);                 // 既存の盤面を上書きする確認（実ブラウザでは <dialog>）
    await page.waitForFunction(() => document.querySelectorAll('#board .cell .value')[0].textContent.trim() !== '' ||
      document.querySelectorAll('#board .cell .value').length > 0, { timeout: 5000 }).catch(() => { });
    await page.waitForFunction(() => document.getElementById('import-text').value !== '', { timeout: 5000 }).catch(() => { });
    check('A-インポート: <dialog> による確認が表示され、OK でインポートできる',
      okShown && (await filled(page)) === 37, 'dialog=' + okShown + ' / clues=' + (await filled(page)));
    await page.click('#btn-analyze');
    await page.waitForFunction(() => /^解析結果：/.test(document.getElementById('analysis-result').textContent.trim()), { timeout: 90000 });
    check('A-解析: 唯一解と判定される（Worker 経路）',
      (await page.textContent('#analysis-result')).indexOf('唯一解') >= 0);
    check('A-採用: 採用ボタンが有効になる',
      await page.evaluate(() => !document.getElementById('btn-adopt').disabled));
    await page.click('#btn-adopt');
    await confirmIfShown(page);
    await page.waitForFunction(() => document.getElementById('stat-difficulty').textContent === '採用した盤面', { timeout: 15000 });
    check('A-採用: プレイモードに切り替わり難易度が「採用した盤面」になる',
      (await page.textContent('#stat-difficulty')) === '採用した盤面' &&
      (await page.evaluate(() => document.getElementById('panel-play').hidden === false)));
    await page.click('#btn-solve');
    await confirmIfShown(page);
    await page.waitForFunction(() => !document.getElementById('completion-panel').hidden, { timeout: 30000 });
    check('A-自動解答: 全マスが埋まり完成表示が出る',
      (await filled(page)) === 81 &&
      (await page.textContent('#completion-text')).indexOf('自動解答') >= 0);
    check('A-全体: ここまでの実行でエラーが無い', errors.length === 0, errors.join(' / '));

    /* --- レイアウト（PC 幅） --- */
    const layout = await page.evaluate(() => {
      const r = document.querySelector('#board .cell').getBoundingClientRect();
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        cellW: Math.round(r.width), cellH: Math.round(r.height),
        boardVisible: document.getElementById('board').getBoundingClientRect().width > 0
      };
    });
    check('A-レイアウト(1280px): 横スクロールが発生しない',
      layout.scrollW <= layout.clientW + 1, layout.scrollW + ' > ' + layout.clientW);
    check('A-レイアウト(1280px): 盤面のマスが正方形に近く、十分な大きさで描画される',
      layout.boardVisible && Math.abs(layout.cellW - layout.cellH) <= 2 && layout.cellW >= 32,
      'cell=' + layout.cellW + 'x' + layout.cellH);
    await page.screenshot({ path: path.join(SHOT_DIR, 'pc.png'), fullPage: true });

    await ctx.close();
  }

  /* ================================ B. スマホ幅（タッチ操作） ================================ */
  {
    const { ctx, page, errors } = await openPage(browser, httpUrl, {
      viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    await page.waitForSelector('#board .cell');
    const layout = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      cellW: Math.round(document.querySelector('#board .cell').getBoundingClientRect().width)
    }));
    check('B-レイアウト(375px): 横スクロールが発生しない',
      layout.scrollW <= layout.clientW + 1, layout.scrollW + ' > ' + layout.clientW);
    check('B-レイアウト(375px): 盤面が画面内に収まる', layout.cellW >= 28, 'cell=' + layout.cellW);
    await page.click('#btn-new');
    await waitIdle(page);
    check('B-生成: スマホ幅でも問題を生成できる',
      (await page.$$eval('#board .cell.initial', (e) => e.length)) >= 26);
    // タップでマスを選び、画面の数字ボタンで入力
    const emptyIdx = await page.$$eval('#board .cell', (els) => els.findIndex((e) => e.className.indexOf('initial') < 0));
    await page.locator('#board .cell').nth(emptyIdx).tap();
    check('B-タッチ: タップでマスを選択できる',
      (await page.$$eval('#board .cell', (els) => els.filter((e) => e.className.indexOf('selected') >= 0).length)) === 1);
    console.log('  （タップ後のフォーカス先: ' + (await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className)))
      + ' / pointer:coarse=' + (await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)) + '）');
    check('B-ソフトキーボード: マスをタップすると数字キーボード用の入力欄にフォーカスが移る',
      await page.evaluate(() => document.activeElement && document.activeElement.id === 'cell-key-input'),
      await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    // ソフトキーボードからの入力を模擬する（Android の IME は input イベントで届く）
    const imeInput = (v) => page.evaluate((val) => {
      const ki = document.getElementById('cell-key-input');
      ki.value = val;
      ki.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await imeInput('6');
    check('B-ソフトキーボード: キーボード入力の数字が選択マスに入る',
      (await values(page))[emptyIdx] === '6', 'value=' + (await values(page))[emptyIdx]);
    check('B-ソフトキーボード: 入力後も入力欄は空に戻る（連続入力できる）',
      await page.evaluate(() => document.getElementById('cell-key-input').value === ''));
    await page.evaluate(() => {
      const ki = document.getElementById('cell-key-input');
      const ev = new Event('beforeinput', { bubbles: true, cancelable: true });
      ev.inputType = 'deleteContentBackward';
      ki.dispatchEvent(ev);
    });
    check('B-ソフトキーボード: 削除（Backspace）で消去される', (await values(page))[emptyIdx] === '');
    await imeInput('4');
    await page.keyboard.press('Backspace');
    check('B-ソフトキーボード: Backspace キーでも消去される', (await values(page))[emptyIdx] === '',
      'value=' + (await values(page))[emptyIdx]);
    await page.locator('#pad button[data-digit]').first().tap();
    check('B-タッチ: 画面の数字ボタンで入力できる', (await userCells(page)) === 1, 'user=' + (await userCells(page)));
    check('B-タッチ: 実行時エラーが無い', errors.length === 0, errors.join(' / '));
    await page.screenshot({ path: path.join(SHOT_DIR, 'mobile.png'), fullPage: true });
    await ctx.close();
  }

  /* ================================ C. file:// で開いた場合（フォールバック） ================================ */
  {
    const { ctx, page, errors } = await openPage(browser, 'file://' + INDEX);
    await page.waitForSelector('#board .cell');
    await page.click('#btn-new');
    await waitIdle(page, 120000);
    check('C-file://: Worker が使えない環境でも問題を生成できる（分割実行フォールバック）',
      (await page.$$eval('#board .cell.initial', (e) => e.length)) >= 26,
      'clues=' + (await page.$$eval('#board .cell.initial', (e) => e.length)));
    check('C-file://: 唯一解の検証が完了する',
      await page.evaluate(() => !document.getElementById('btn-check').disabled));
    await page.keyboard.press('4');
    check('C-file://: キーボード入力も動作する', (await userCells(page)) === 1, 'user=' + (await userCells(page)));
    const workerNote = await page.evaluate(() => window.__workerCtor);
    console.log('  （file:// での Worker 生成回数: ' + workerNote + '／実行時エラー: ' + (errors.length ? errors.join(' / ') : 'なし') + '）');
    await ctx.close();
  }

  await browser.close();
  srv.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n--- 実ブラウザテスト: ' + (results.length - failed.length) + ' / ' + results.length + ' 成功 ---');
  console.log('スクリーンショット: ' + SHOT_DIR);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('実ブラウザテストが例外で停止しました: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
