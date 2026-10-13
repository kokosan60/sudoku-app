#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
テスト用の固定盤面を探索する独立実装（本アプリのJSとは別実装・高速版）。
ヒント探索順を独立実装し、各手法が「最初に検出される」盤面と期待値を確定する。
"""
import random, json, sys

FULL_MASK = 0x3FE

def box(r, c):
    return (r // 3) * 3 + (c // 3)

def bits(m):
    return [d for d in range(1, 10) if m & (1 << d)]

def unit_cells(t, i):
    if t == 'row':
        return [(i, c) for c in range(9)]
    if t == 'col':
        return [(r, i) for r in range(9)]
    br, bc = (i // 3) * 3, (i % 3) * 3
    return [(br + rr, bc + cc) for rr in range(3) for cc in range(3)]

def find_dups(board):
    d = set()
    for t in ('row', 'col', 'box'):
        for i in range(9):
            seen = {}
            for (r, c) in unit_cells(t, i):
                v = board[r][c]
                if v:
                    seen.setdefault(v, []).append((r, c))
            for v, ps in seen.items():
                if len(ps) > 1:
                    d.update(ps)
    return d

def all_cands(board):
    cand = [[[] for _ in range(9)] for _ in range(9)]
    for r in range(9):
        for c in range(9):
            if board[r][c]:
                continue
            used = 0
            for i in range(9):
                used |= 1 << board[r][i]
                used |= 1 << board[i][c]
            for (rr, cc) in unit_cells('box', box(r, c)):
                used |= 1 << board[rr][cc]
            cand[r][c] = bits(FULL_MASK & ~used)
    return cand

def count_solutions(board, limit=2):
    b = [row[:] for row in board]
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9
    for r in range(9):
        for c in range(9):
            v = b[r][c]
            if v:
                m = 1 << v
                rows[r] |= m
                cols[c] |= m
                boxes[box(r, c)] |= m
    state = {'count': 0, 'first': None}
    def dfs():
        if state['count'] >= limit:
            return
        best = None
        bcand = 0
        bn = 10
        for r in range(9):
            for c in range(9):
                if b[r][c]:
                    continue
                cand = FULL_MASK & ~(rows[r] | cols[c] | boxes[box(r, c)])
                if cand == 0:
                    return
                n = bin(cand).count('1')
                if n < bn:
                    bn = n
                    best = (r, c)
                    bcand = cand
                    if n == 1:
                        break
            if bn == 1:
                break
        if best is None:
            state['count'] += 1
            if state['first'] is None:
                state['first'] = [row[:] for row in b]
            return
        r, c = best
        m = bcand
        while m and state['count'] < limit:
            bit = m & -m
            m ^= bit
            d = bit.bit_length() - 1
            b[r][c] = d
            rows[r] |= bit
            cols[c] |= bit
            boxes[box(r, c)] |= bit
            dfs()
            b[r][c] = 0
            rows[r] &= ~bit
            cols[c] &= ~bit
            boxes[box(r, c)] &= ~bit
    dfs()
    return state['count'], state['first'], state['count'] < limit

def gen_full(rng):
    b = [[0] * 9 for _ in range(9)]
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9
    def fill(k):
        if k == 81:
            return True
        r, c = divmod(k, 9)
        cands = bits(FULL_MASK & ~(rows[r] | cols[c] | boxes[box(r, c)]))
        rng.shuffle(cands)
        for d in cands:
            m = 1 << d
            b[r][c] = d
            rows[r] |= m
            cols[c] |= m
            boxes[box(r, c)] |= m
            if fill(k + 1):
                return True
            b[r][c] = 0
            rows[r] &= ~m
            cols[c] &= ~m
            boxes[box(r, c)] &= ~m
        return False
    fill(0)
    return b

def first_hint(board, cand=None):
    if find_dups(board):
        return ('invalid', None, None, None, None)
    if all(board[r][c] for r in range(9) for c in range(9)):
        return ('complete', None, None, None, None)
    cand = cand or all_cands(board)
    for r in range(9):
        for c in range(9):
            if board[r][c] == 0 and not cand[r][c]:
                return ('contradiction', 'cell', r, c, None)
    for t in ('row', 'col', 'box'):
        for i in range(9):
            cells = unit_cells(t, i)
            placed = set(board[r][c] for r, c in cells if board[r][c])
            for d in range(1, 10):
                if d in placed:
                    continue
                if not any(board[r][c] == 0 and d in cand[r][c] for (r, c) in cells):
                    return ('contradiction', 'unit_' + t, i, d, None)
    for r in range(9):
        for c in range(9):
            if board[r][c] == 0 and len(cand[r][c]) == 1:
                return ('found', 'naked_single', r, c, cand[r][c][0])
    for t, tech in (('row', 'hidden_single_row'), ('col', 'hidden_single_col'), ('box', 'hidden_single_box')):
        for i in range(9):
            cells = unit_cells(t, i)
            placed = set(board[r][c] for r, c in cells if board[r][c])
            for d in range(1, 10):
                if d in placed:
                    continue
                spots = [(r, c) for (r, c) in cells if board[r][c] == 0 and d in cand[r][c]]
                if len(spots) == 1:
                    return ('found', tech, spots[0][0], spots[0][1], d)
    return ('none', None, None, None, None)

def blank_from(solution, rng, keep):
    b = [row[:] for row in solution]
    positions = list(range(81))
    rng.shuffle(positions)
    for p in positions[:81 - keep]:
        b[p // 9][p % 9] = 0
    return b

def flat(b):
    return ''.join(str(b[r][c]) for r in range(9) for c in range(9))

def main():
    rng = random.Random(777001)
    out = {}

    wanted = {'naked_single': None, 'hidden_single_row': None,
              'hidden_single_col': None, 'hidden_single_box': None}
    tries = 0
    while any(v is None for v in wanted.values()) and tries < 300000:
        tries += 1
        sol = gen_full(rng)
        keep = rng.randint(28, 40)
        b = blank_from(sol, rng, keep)
        cand = all_cands(b)
        st, tech, r, c, d = first_hint(b, cand)
        if st == 'found' and tech in wanted and wanted[tech] is None:
            wanted[tech] = {'board': b, 'solution': sol, 'r': r, 'c': c, 'digit': d, 'clues': keep}
    for k, v in wanted.items():
        print('# hint', k, '=>', None if v is None else (v['r'], v['c'], v['digit'], v['clues']), file=sys.stderr)
    out['hintBoards'] = wanted
    out['hintTries'] = tries
    with open('boards_partial.json', 'w') as f:
        json.dump(out, f, indent=1)

    # 唯一解: 裸のシングル盤面を唯一解化（初期配置を増やして確認）
    uniq = None
    base = wanted['naked_single']['board']
    for extra in range(0, 40):
        cands = [(r, c) for r in range(9) for c in range(9) if base[r][c] == 0]
        rng.shuffle(cands)
        b = [row[:] for row in base]
        for (r, c) in cands[:extra]:
            b[r][c] = wanted['naked_single']['solution'][r][c]
        cnt, sol, _ = count_solutions(b, 2)
        if cnt == 1:
            st, tech, r, c, d = first_hint(b)
            if st == 'found' and tech == 'naked_single':
                uniq = {'board': b, 'solution': sol, 'r': r, 'c': c, 'digit': d,
                        'clues': sum(1 for rr in range(9) for cc in range(9) if b[rr][cc])}
                break
    assert uniq, 'unique naked-single board not found'
    out['uniqueBoard'] = uniq

    # 複数解: 4マスの矩形交換（unavoidable set）を作る → 必ず2解以上
    multi = None
    for _ in range(2000):
        sol = gen_full(rng)
        found = None
        for r1 in range(9):
            for r2 in range(r1 + 1, 9):
                for c1 in range(9):
                    for c2 in range(c1 + 1, 9):
                        a, bv = sol[r1][c1], sol[r1][c2]
                        if a == bv:
                            continue
                        if sol[r2][c1] == bv and sol[r2][c2] == a:
                            found = (r1, r2, c1, c2)
                            break
                    if found:
                        break
                if found:
                    break
            if found:
                break
        if not found:
            continue
        r1, r2, c1, c2 = found
        b = [row[:] for row in sol]
        for (r, c) in ((r1, c1), (r1, c2), (r2, c1), (r2, c2)):
            b[r][c] = 0
        cnt, solx, _ = count_solutions(b, 2)
        if cnt >= 2:
            multi = {'board': b, 'solutions': cnt, 'rect': [r1, r2, c1, c2]}
            break
    assert multi, 'multiple-solution board not found'
    out['multipleBoard'] = multi

    # 解なし（重複なし）
    nosol = None
    for _ in range(20000):
        sol = gen_full(rng)
        b = blank_from(sol, rng, rng.randint(30, 40))
        cnt, _, _ = count_solutions(b, 2)
        if cnt != 1:
            continue
        empties = [(r, c) for r in range(9) for c in range(9) if b[r][c] == 0]
        rng.shuffle(empties)
        for (r, c) in empties:
            cand = all_cands(b)
            cands = [d for d in cand[r][c] if d != sol[r][c]]
            rng.shuffle(cands)
            for d in cands:
                b2 = [row[:] for row in b]
                b2[r][c] = d
                if find_dups(b2):
                    continue
                c2, _, _ = count_solutions(b2, 2)
                if c2 == 0:
                    nosol = b2
                    break
            if nosol:
                break
        if nosol:
            break
    assert nosol, 'no-solution board not found'
    out['noSolutionBoard'] = {'board': nosol}

    dupb = [row[:] for row in gen_full(rng)]
    dupb[0][1] = dupb[0][0]
    out['duplicateBoard'] = {'board': dupb}

    # 候補0個の矛盾（+ 別の場所に裸のシングル）
    contra_cell = None
    for _ in range(200000):
        sol = gen_full(rng)
        b = blank_from(sol, rng, rng.randint(30, 45))
        empties = [(r, c) for r in range(9) for c in range(9) if b[r][c] == 0]
        rng.shuffle(empties)
        for (r, c) in empties[:8]:
            cand = all_cands(b)
            cands = [d for d in cand[r][c] if d != sol[r][c]]
            rng.shuffle(cands)
            for d in cands[:4]:
                b2 = [row[:] for row in b]
                b2[r][c] = d
                if find_dups(b2):
                    continue
                cand2 = all_cands(b2)
                zero = [(rr, cc) for rr in range(9) for cc in range(9)
                        if b2[rr][cc] == 0 and not cand2[rr][cc]]
                if not zero:
                    continue
                naked = [(rr, cc) for rr in range(9) for cc in range(9)
                         if b2[rr][cc] == 0 and len(cand2[rr][cc]) == 1 and (rr, cc) not in zero]
                if naked:
                    contra_cell = {'board': b2, 'zeroCells': zero, 'nakedCells': naked}
                    break
            if contra_cell:
                break
        if contra_cell:
            break
    assert contra_cell, 'contradiction(cell) board not found'
    out['contradictionCellBoard'] = contra_cell

    # ユニット配置0の矛盾（候補0個のマスなし）+ 別の場所に裸のシングル
    contra_unit = None
    for _ in range(200000):
        sol = gen_full(rng)
        b = blank_from(sol, rng, rng.randint(30, 45))
        empties = [(r, c) for r in range(9) for c in range(9) if b[r][c] == 0]
        rng.shuffle(empties)
        for (r, c) in empties[:8]:
            cand = all_cands(b)
            cands = [d for d in cand[r][c] if d != sol[r][c]]
            rng.shuffle(cands)
            for d in cands[:4]:
                b2 = [row[:] for row in b]
                b2[r][c] = d
                if find_dups(b2):
                    continue
                cand2 = all_cands(b2)
                if any(b2[rr][cc] == 0 and not cand2[rr][cc] for rr in range(9) for cc in range(9)):
                    continue
                bad = None
                for t in ('row', 'col', 'box'):
                    for i in range(9):
                        cells = unit_cells(t, i)
                        placed = set(b2[rr][cc] for rr, cc in cells if b2[rr][cc])
                        for dd in range(1, 10):
                            if dd in placed:
                                continue
                            if not any(b2[rr][cc] == 0 and dd in cand2[rr][cc] for (rr, cc) in cells):
                                bad = [t, i, dd]
                                break
                        if bad:
                            break
                    if bad:
                        break
                if not bad:
                    continue
                naked = [(rr, cc) for rr in range(9) for cc in range(9)
                         if b2[rr][cc] == 0 and len(cand2[rr][cc]) == 1]
                if naked:
                    contra_unit = {'board': b2, 'badUnit': bad, 'nakedCells': naked}
                    break
            if contra_unit:
                break
        if contra_unit:
            break
    assert contra_unit, 'contradiction(unit) board not found'
    out['contradictionUnitBoard'] = contra_unit

    with open('boards.json', 'w') as f:
        json.dump(out, f, indent=1)

    print('=== hint boards (tries=%d) ===' % tries)
    for k, v in wanted.items():
        print(k, 'first hint =', (v['r'], v['c'], v['digit']), 'clues =', v['clues'])
        print(flat(v['board']))
    print('=== unique naked single ===', flat(uniq['board']), 'clues=', uniq['clues'], 'target=', (uniq['r'], uniq['c'], uniq['digit']))
    print('=== multiple ===', flat(multi['board']), 'rect=', multi['rect'], 'count=', multi['solutions'])
    print('=== no solution ===', flat(nosol))
    print('=== duplicate ===', flat(out['duplicateBoard']['board']))
    print('=== contra cell ===', flat(contra_cell['board']), 'zero=', contra_cell['zeroCells'][:3], 'naked=', contra_cell['nakedCells'][:3])
    print('=== contra unit ===', flat(contra_unit['board']), 'bad=', contra_unit['badUnit'], 'naked=', contra_unit['nakedCells'][:3])

if __name__ == '__main__':
    main()
