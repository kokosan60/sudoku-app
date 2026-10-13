/* =============================================================================
 * SudokuTests — 計算ロジックの自動テスト（DOM に依存しない）
 * -----------------------------------------------------------------------------
 * ・固定盤面は、本アプリとは別実装のソルバー（Python）で「仕様の検出順で
 *   最初に見つかる手法」を確定させたものを使用している。
 * ・SudokuTests.list() でテスト名一覧、runOne(i) で 1 件ずつ、
 *   run() でまとめて実行できる（ブラウザ UI は runOne を分割実行する）。
 * ・期待値だけでなく「先に検出される手法が存在しないこと」も独立スキャンで検証する。
 * ===========================================================================*/
var SudokuTests = (function () {
  'use strict';
  var C = SudokuCore;

  /** 81 文字の文字列を 9x9 配列にする（テスト用の固定盤面の記述に使用）。 */
  function B(s) {
    var b = [];
    for (var r = 0; r < 9; r++) {
      var row = [];
      for (var c = 0; c < 9; c++) row.push(parseInt(s.charAt(r * 9 + c), 10));
      b.push(row);
    }
    return b;
  }

  /* ---- 固定テスト盤面（Python 実装で期待値を確定済み） ---- */
  var FIX = {
    // 裸のシングルが最初に検出される唯一解の問題（期待: 2行1列に 7）
    nakedBoard: '852001090090402106004509200901208043605300900300904500230000800006003000400800370',
    nakedSolution: '852631794793482156164579238971258643645317982328964517237145869586793421419826375',
    // 行の隠れたシングル（期待: 2行9列に 6）※裸のシングルは存在しない
    hiddenRowBoard: '000400007143008000078006400010800040039000602004207000000049000050780960000000008',
    // 列の隠れたシングル（期待: 6行7列に 2）※裸・行の隠れは存在しない
    hiddenColBoard: '400000000580903002201780006000090370002000008000800094010000003324600009000300020',
    // ブロックの隠れたシングル（期待: 8行7列に 8）※裸・行・列の隠れは存在しない
    hiddenBoxBoard: '304057298070800300000030706000010000007000100000020600200080000000370060700096430',
    // 複数解（4マスの交換可能な矩形を空けた盤面）
    multipleBoard: '618905302547823961293601508452196837361587294789432156836719425974258613125364789',
    // 重複なしだが解なし
    noSolutionBoard: '000750900780903060602004300541697000003140006007000100000060720000875003079320650',
    // 重複あり（(1行1列) と (1行2列) がともに 4）
    duplicateBoard: '441286793678935142239174568516842379327569814984713256145398627763421985892657431',
    // 候補0個のマス（1行3列）＋別の場所に裸のシングル
    contraCellBoard: '700345018908701400346000000635400087209578304870600000462100095007950032000820741',
    // 候補0個のマスは無いが、2列目で 1 を置ける空欄が無い＋別の場所に裸のシングル
    contraUnitBoard: '580036940060081502420790080094002150030604890170053060001048600800000430302509708'
  };

  /* ---- テスト登録 ---- */
  var tests = [];
  function test(name, fn, slow) { tests.push({ name: name, fn: fn, slow: !!slow }); }
  function ok(cond, msg) { if (!cond) throw new Error(msg); }
  function eq(actual, expected, label) {
    if (actual !== expected) throw new Error(label + ' — 期待: ' + expected + ' / 実際: ' + actual);
  }
  function eqBoard(actual, expected, label) {
    var a = C.boardKey(actual), e = C.boardKey(expected);
    if (a !== e) throw new Error(label + ' — 盤面が一致しません\n期待: ' + e + '\n実際: ' + a);
  }

  /* ---- 独立スキャン（findLogicalHint の検出順を経由せず条件を確認する） ---- */
  function scanNakedSingle(board) {
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      if (board[r][c] !== 0) continue;
      var cand = C.getCandidates(board, r, c);
      if (cand.length === 1) return { row: r, col: c, digit: cand[0] };
    }
    return null;
  }
  function scanHiddenSingle(board, type) {
    for (var i = 0; i < 9; i++) {
      var cells = C.unitCells(type, i), placed = {};
      for (var j = 0; j < cells.length; j++) {
        var v = board[cells[j][0]][cells[j][1]];
        if (v) placed[v] = true;
      }
      for (var d = 1; d <= 9; d++) {
        if (placed[d]) continue;
        var spots = [];
        for (var k = 0; k < cells.length; k++) {
          var r = cells[k][0], c = cells[k][1];
          if (board[r][c] === 0 && C.getCandidates(board, r, c).indexOf(d) >= 0) spots.push([r, c]);
        }
        if (spots.length === 1) return { type: type, index: i, row: spots[0][0], col: spots[0][1], digit: d };
      }
    }
    return null;
  }

  /* ============================== 1. 基本処理 ============================== */

  test('重複検出：行・列・ブロックの重複を検出し、空欄は対象外', function () {
    var b = C.createBoard();
    b[0][0] = 5; b[0][4] = 5;                 // 同じ行の重複
    b[3][1] = 7; b[6][1] = 7;                 // 同じ列の重複
    b[4][4] = 9; b[5][5] = 9;                 // 同じブロックの重複
    var dups = C.findDuplicates(b);
    ok(dups.length === 6, '重複マスは 6 個のはず: ' + dups.length);
    ok(dups.indexOf(0) >= 0 && dups.indexOf(4) >= 0, '1行1列と1行5列が重複として検出されること');
    ok(dups.indexOf(28) >= 0 && dups.indexOf(55) >= 0, '同じ列の重複が検出されること');
    ok(dups.indexOf(40) >= 0 && dups.indexOf(50) >= 0, '同じブロックの重複が検出されること');
    ok(C.findDuplicates(C.createBoard()).length === 0, '空欄だけの盤面は重複なし');
    // 候補メモ（別管理のデータ）は重複判定に影響しないこと
    var notes = C.createNotes();
    notes[0][1] = [5];
    ok(C.findDuplicates(b).length === 6, '候補メモは重複判定に影響しないこと');
  });

  test('完成盤面の判定：有効な完成盤面と重複のある満杯盤面を区別', function () {
    var solved = B(FIX.nakedSolution);
    ok(C.isCompleteValid(solved), '唯一解の正解盤面は有効な完成盤面');
    ok(C.findLogicalHint(solved).status === 'complete', 'ヒント関数も complete を返す');
    var dupFull = C.cloneBoard(solved);
    dupFull[0][1] = dupFull[0][0];
    ok(!C.isCompleteValid(dupFull), '重複のある満杯盤面は完成とみなさない');
    var incomplete = C.cloneBoard(solved);
    incomplete[8][8] = 0;
    ok(!C.isCompleteValid(incomplete), '空欄がある盤面は完成とみなさない');
  });

  test('解数の判定：唯一解／複数解／解なし（重複なし）／重複あり', function () {
    var u = C.runSync(C.solveTask(B(FIX.nakedBoard), { limit: 2 }));
    eq(C.classifySolveResult(u), 'unique', '固定盤面は唯一解');
    eqBoard(u.solution, B(FIX.nakedSolution), '保存された正解と一致');

    var m = C.runSync(C.solveTask(B(FIX.multipleBoard), { limit: 2 }));
    eq(C.classifySolveResult(m), 'multiple', '矩形を空けた盤面は複数解');
    ok(m.count >= 2, '2 個以上の解が見つかること');

    var n = C.runSync(C.solveTask(B(FIX.noSolutionBoard), { limit: 2 }));
    eq(C.classifySolveResult(n), 'none', '重複なしだが解なしの盤面');
    eq(n.count, 0, '解の個数は 0');
    eq(n.complete, true, '探索は完了していること');

    var d = B(FIX.duplicateBoard);
    ok(C.hasDuplicates(d), '重複ありの盤面を検出できること');
    eq(C.findDuplicates(d).indexOf(0) >= 0, true, '1行1列が重複に関与');
    eq(C.findDuplicates(d).indexOf(1) >= 0, true, '1行2列が重複に関与');
  });

  test('探索が元の盤面を変更しない', function () {
    var src = B(FIX.nakedBoard);
    var before = C.boardKey(src);
    C.runSync(C.solveTask(src, { limit: 2 }));
    eq(C.boardKey(src), before, '解探索後も盤面が変わらないこと');
    var multi = B(FIX.multipleBoard), mBefore = C.boardKey(multi);
    C.runSync(C.solveTask(multi, { limit: 2 }));
    eq(C.boardKey(multi), mBefore, '複数解の探索でも盤面が変わらないこと');
  });

  test('探索未完了（limit=1 で打ち切り）を唯一解と誤判定しない', function () {
    var r = C.runSync(C.solveTask(B(FIX.nakedBoard), { limit: 1 }));
    eq(r.count, 1, '解を 1 個発見');
    eq(r.complete, false, '探索は完了していない');
    eq(r.aborted, 'limit', '打ち切り理由は limit');
    eq(C.classifySolveResult(r), 'limited', '唯一解とも解なしとも判定しない');
  });

  /* ============================== 2. 生成 ============================== */

  function genTest(minClues, maxClues, seed) {
    var res = C.runSync(C.generateTask({
      minClues: minClues, maxClues: maxClues, seed: seed,
      maxAttempts: 400, deadline: Date.now() + 60000
    }));
    ok(res.ok === true, '生成に成功すること（reason=' + res.reason + '）');
    var clues = 0;
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) if (res.puzzle[r][c] !== 0) clues++;
    eq(clues, res.clues, '初期配置数の申告が実際と一致');
    ok(clues >= minClues && clues <= maxClues, '初期配置数が範囲内であること: ' + clues);
    var verify = C.runSync(C.solveTask(res.puzzle, { limit: 2 }));
    eq(C.classifySolveResult(verify), 'unique', '生成問題は唯一解');
    eqBoard(verify.solution, res.solution, '生成した正解盤面と一致');
    ok(C.isCompleteValid(res.solution), '正解盤面は有効な完成盤面');
    // 初期配置は正解と一致していること
    for (var r2 = 0; r2 < 9; r2++) for (var c2 = 0; c2 < 9; c2++) {
      if (res.puzzle[r2][c2] !== 0 && res.puzzle[r2][c2] !== res.solution[r2][c2]) {
        throw new Error('初期配置が正解と食い違っています (' + (r2 + 1) + '行' + (c2 + 1) + '列)');
      }
    }
    return res;
  }

  test('生成：やさしい（初期配置 40〜46 個・唯一解）', function () {
    var res = genTest(40, 46, 20261013);
    ok(res.clues >= 40 && res.clues <= 46, 'やさしいの初期配置数: ' + res.clues);
  }, true);

  test('生成：ふつう（初期配置 32〜39 個・唯一解）', function () {
    var res = genTest(32, 39, 1234567);
    ok(res.clues >= 32 && res.clues <= 39, 'ふつうの初期配置数: ' + res.clues);
  }, true);

  test('生成：むずかしい（初期配置 26〜31 個・唯一解）', function () {
    var res = genTest(26, 31, 987654321);
    ok(res.clues >= 26 && res.clues <= 31, 'むずかしいの初期配置数: ' + res.clues);
  }, true);

  test('生成：指定範囲の問題を作れない場合は失敗を返す（範囲外を成功として返さない）', function () {
    var res = C.runSync(C.generateTask({
      minClues: 17, maxClues: 17, seed: 42, maxAttempts: 2, deadline: Date.now() + 400
    }));
    eq(res.ok, false, '生成失敗として返すこと');
    ok(res.reason === 'time' || res.reason === 'attempts', '失敗理由が time か attempts: ' + res.reason);
    eq(typeof res.puzzle, 'undefined', '失敗時は問題データを返さない');
  }, true);

  /* ============================== 3. 論理ヒント ============================== */

  test('ヒント：裸のシングル（固定盤面・候補も検証）', function () {
    var b = B(FIX.nakedBoard);
    var res = C.findLogicalHint(b);
    eq(res.status, 'found', '一手が見つかること');
    eq(res.technique, 'naked_single', '手法は裸のシングル');
    eq(res.row, 1, '対象は2行目');
    eq(res.col, 0, '対象は1列目');
    eq(res.digit, 7, '確定数字は 7');
    eq(res.candidates.join(','), '7', '対象マスの論理候補は [7]');
    eq(res.units.length, 3, '根拠は行・列・ブロックの3つ');
    ok(res.reason.indexOf('7') >= 0, '理由文に確定数字が含まれること');
  });

  test('ヒント：行の隠れたシングル（先に検出される手法が無いこと）', function () {
    var b = B(FIX.hiddenRowBoard);
    eq(scanNakedSingle(b), null, '裸のシングルが存在しないこと');
    var res = C.findLogicalHint(b);
    eq(res.technique, 'hidden_single_row', '手法は行の隠れたシングル');
    eq(res.row, 1, '対象は2行目');
    eq(res.col, 8, '対象は9列目');
    eq(res.digit, 6, '確定数字は 6');
    eq(res.units.length, 1, '根拠ユニットは 1 つ');
    eq(res.units[0].type, 'row', '根拠は行');
    eq(res.units[0].index, 1, '根拠は2行目');
    var scan = scanHiddenSingle(b, 'row');
    eq(scan.row, 1, '独立スキャンでも2行目');
    eq(scan.col, 8, '独立スキャンでも9列目');
    eq(scan.digit, 6, '独立スキャンでも 6');
  });

  test('ヒント：列の隠れたシングル（裸・行の隠れが無いこと）', function () {
    var b = B(FIX.hiddenColBoard);
    eq(scanNakedSingle(b), null, '裸のシングルが存在しないこと');
    eq(scanHiddenSingle(b, 'row'), null, '行の隠れたシングルが存在しないこと');
    var res = C.findLogicalHint(b);
    eq(res.technique, 'hidden_single_col', '手法は列の隠れたシングル');
    eq(res.row, 5, '対象は6行目');
    eq(res.col, 6, '対象は7列目');
    eq(res.digit, 2, '確定数字は 2');
    eq(res.units[0].type, 'col', '根拠は列');
    eq(res.units[0].index, 6, '根拠は7列目');
  });

  test('ヒント：ブロックの隠れたシングル（裸・行・列の隠れが無いこと）', function () {
    var b = B(FIX.hiddenBoxBoard);
    eq(scanNakedSingle(b), null, '裸のシングルが存在しないこと');
    eq(scanHiddenSingle(b, 'row'), null, '行の隠れたシングルが存在しないこと');
    eq(scanHiddenSingle(b, 'col'), null, '列の隠れたシングルが存在しないこと');
    var res = C.findLogicalHint(b);
    eq(res.technique, 'hidden_single_box', '手法はブロックの隠れたシングル');
    eq(res.row, 7, '対象は8行目');
    eq(res.col, 6, '対象は7列目');
    eq(res.digit, 8, '確定数字は 8');
    eq(res.units[0].type, 'box', '根拠はブロック');
    eq(res.units[0].index, C.boxIndex(7, 6), '根拠ブロックが対象マスと一致');
  });

  test('ヒント：同じ盤面では同じ一手を選び、候補メモの影響を受けない', function () {
    var b = B(FIX.hiddenColBoard);
    var a1 = C.findLogicalHint(b);
    var a2 = C.findLogicalHint(C.cloneBoard(b));
    eq(a1.technique + a1.row + ',' + a1.col + a1.digit, a2.technique + a2.row + ',' + a2.col + a2.digit, '同じ結果が返ること');
    // 候補メモは findLogicalHint の引数ではないため、メモの内容は結果に影響しない
    var notes = C.createNotes();
    notes[5][6] = [1, 9];
    notes[0][0] = [2];
    var a3 = C.findLogicalHint(b);
    eq(a1.technique + a1.row + ',' + a1.col + a1.digit, a3.technique + a3.row + ',' + a3.col + a3.digit, 'メモを変更しても結果は不変');
    // 引数は盤面のみ（正解盤面に依存しない）
    eq(C.findLogicalHint.length, 1, 'findLogicalHint の引数は 1 つ（盤面のみ）');
    ok(C.findLogicalHint.toString().indexOf('solution') === -1, '実装が正解盤面を参照していないこと');
    var before = C.boardKey(b);
    C.findLogicalHint(b);
    eq(C.boardKey(b), before, 'ヒント探索は盤面を変更しない');
  });

  test('ヒント：候補0個の矛盾を検出し、一手を提示しない（別の場所に裸のシングルがあっても）', function () {
    var b = B(FIX.contraCellBoard);
    eq(C.findDuplicates(b).length, 0, '前提: 重複は無い');
    eq(C.getCandidates(b, 0, 2).length, 0, '前提: 1行3列の候補は 0 個');
    ok(scanNakedSingle(b) !== null, '前提: 別の場所に裸のシングルが存在する');
    var res = C.findLogicalHint(b);
    eq(res.status, 'contradiction', '矛盾として扱い、一手を提示しない');
    eq(typeof res.digit, 'undefined', '確定数字は返さない');
  });

  test('ヒント：未配置数字の配置場所が0個の矛盾を検出する', function () {
    var b = B(FIX.contraUnitBoard);
    eq(C.findDuplicates(b).length, 0, '前提: 重複は無い');
    var anyZero = false;
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      if (b[r][c] === 0 && C.getCandidates(b, r, c).length === 0) anyZero = true;
    }
    eq(anyZero, false, '前提: 候補0個のマスは存在しない');
    var res = C.findLogicalHint(b);
    eq(res.status, 'contradiction', '矛盾として扱う');
    ok(res.problems.some(function (p) { return p.kind === 'unit'; }), 'ユニット由来の矛盾が含まれること');
  });

  test('ヒント：形式不正（範囲外の値・サイズ違い）は invalid', function () {
    var b = B(FIX.nakedBoard);
    b[3][3] = 12;
    eq(C.findLogicalHint(b).status, 'invalid', '範囲外の値は invalid');
    var small = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    eq(C.findLogicalHint(small).status, 'invalid', '9x9 でない盤面は invalid');
    var dup = B(FIX.duplicateBoard);
    eq(C.findLogicalHint(dup).status, 'invalid', '重複がある盤面は invalid');
  });

  test('ヒント：対応手法で一手が見つからない場合は none（解なしと断定しない）', function () {
    // 唯一解だが裸・隠れたシングルでは進めない盤面（初期配置を減らした盤面を利用）
    var b = B('000000000000003085001020000000507000004000100090000000500000073002010000000040009');
    var res = C.findLogicalHint(b);
    ok(res.status === 'none' || res.status === 'found', 'none か found のいずれか（invalid や complete ではない）: ' + res.status);
    if (res.status === 'none') ok(res.status !== 'complete', 'none を完成扱いしないこと');
    eq(C.classifySolveResult(C.runSync(C.solveTask(b, { limit: 2 }))) === 'none' ? 'none' : 'ok', 'ok', '前提: この盤面は解が存在する（解なしではない）');
  });

  /* ============================== 4. 候補とインポート ============================== */

  test('候補計算：初期配置とユーザー入力を反映し、昇順で返す', function () {
    var b = C.createBoard();
    b[0][0] = 9; b[0][1] = 8; b[1][0] = 7;      // 行・列・ブロックの制約
    var cand = C.getCandidates(b, 1, 1);
    ok(cand.indexOf(9) < 0 && cand.indexOf(8) < 0 && cand.indexOf(7) < 0, '既存数字は候補に含まれない');
    var sorted = cand.slice().sort(function (x, y) { return x - y; });
    eq(cand.join(','), sorted.join(','), '候補は昇順');
    eq(C.getCandidates(b, 0, 0).length, 0, '数字が入っているマスの候補は空');
    // ユーザー入力を 1 つ増やすと、同じ行の別マスの候補が減ること
    var target = -1;
    for (var c = 2; c < 9; c++) if (b[1][c] === 0) { target = c; break; }
    var before = C.getCandidates(b, 1, target);
    var d = before[0];
    b[1][3] = d;                                  // 行にユーザー数字を追加
    var after = C.getCandidates(b, 1, target);
    eq(after.indexOf(d), -1, '追加した数字は他のマスの候補から除かれる');
    ok(after.length < before.length, '候補数が減ること');
  });

  test('インポート：空白除去・. と 0・不正文字・文字数の検証', function () {
    var src = FIX.nakedBoard;
    var spaced = '';
    for (var i = 0; i < 81; i++) {
      spaced += (i % 9 === 0 ? '\n' : (i % 3 === 0 ? ' ' : '')) + (i === 40 ? '.' : src.charAt(i));
    }
    var res = C.normalizeImport(spaced);
    eq(res.ok, true, '空白・改行を含む入力を受け付ける');
    var expected = B(src);
    expected[4][4] = 0;
    eqBoard(res.board, expected, '. は空欄として扱う');
    eq(res.board[0][0], 8, '左上から行順に反映される');

    eq(C.normalizeImport(src.replace('0', 'x')).ok, false, '不正な文字は受け付けない');
    eq(C.normalizeImport(src.slice(0, 80)).ok, false, '80 文字は受け付けない');
    eq(C.normalizeImport('').ok, false, '空入力は受け付けない');
    var zeros = new Array(82).join('0');
    var allEmpty = C.normalizeImport(zeros);
    eq(allEmpty.ok, true, '0 だけの 81 文字は受け付ける');
    eq(C.boardKey(allEmpty.board), zeros, 'すべて空欄として読み込む');
    eq(allEmpty.duplicates.length, 0, '空欄だけなら重複なし');
  });

  /* ============================== 実行 ============================== */

  function runOne(index) {
    var t = tests[index];
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var out = { index: index, name: t.name, pass: true, detail: '', slow: t.slow, ms: 0 };
    try {
      t.fn();
    } catch (e) {
      out.pass = false;
      out.detail = String(e && e.message ? e.message : e);
    }
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    out.ms = Math.round(t1 - t0);
    return out;
  }

  function run() {
    var results = [];
    for (var i = 0; i < tests.length; i++) results.push(runOne(i));
    var passed = results.filter(function (r) { return r.pass; }).length;
    return {
      results: results, total: results.length, passed: passed, failed: results.length - passed,
      ms: results.reduce(function (a, r) { return a + r.ms; }, 0)
    };
  }

  return {
    list: function () { return tests.map(function (t) { return { name: t.name, slow: t.slow }; }); },
    count: function () { return tests.length; },
    runOne: runOne,
    run: run,
    fixtures: FIX
  };
})();
