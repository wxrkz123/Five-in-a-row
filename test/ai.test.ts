import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLACK, Board, Game, WHITE, type Stone } from '../src/core/board.ts'
import { chooseMove, scorePoint, SCORE, type Level } from '../src/core/ai.ts'

/** 用字符串画棋盘：X 黑、O 白、. 空 */
function boardFrom(rows: string[]): Board {
  const board = new Board(rows.length)
  rows.forEach((row, y) => {
    ;[...row.replace(/\s/g, '')].forEach((ch, x) => {
      if (ch === 'X') board.place(x, y, BLACK)
      else if (ch === 'O') board.place(x, y, WHITE)
    })
  })
  return board
}

const EMPTY_ROW = '. . . . . . . . . . . . . . .'

function rows(overrides: Record<number, string>): string[] {
  return Array.from({ length: 15 }, (_, y) => overrides[y] ?? EMPTY_ROW)
}

/** 固定种子的伪随机数，保证测试可复现 */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const LEVELS: Level[] = ['easy', 'normal', 'hard']

test('空棋盘第一手下在天元', () => {
  assert.deepEqual(chooseMove(new Board(), BLACK), { x: 7, y: 7 })
})

test('棋型识别', () => {
  const board = boardFrom(rows({ 7: '. . . . . X X X . . . . . . .' }))
  // 两端都空：落子后成活四
  assert.equal(scorePoint(board, { x: 4, y: 7 }, BLACK), SCORE.LIVE_FOUR)
  assert.equal(scorePoint(board, { x: 8, y: 7 }, BLACK), SCORE.LIVE_FOUR)

  const blocked = boardFrom(rows({ 7: '. . . . O X X X . . . . . . .' }))
  // 一端被堵：只能成冲四
  assert.ok(scorePoint(blocked, { x: 8, y: 7 }, BLACK) >= SCORE.FOUR)
  assert.ok(scorePoint(blocked, { x: 8, y: 7 }, BLACK) < SCORE.DOUBLE_THREE)

  const four = boardFrom(rows({ 7: '. . . . X X . X X . . . . . .' }))
  assert.equal(scorePoint(four, { x: 6, y: 7 }, BLACK), SCORE.FIVE)
})

for (const level of LEVELS) {
  test(`[${level}] 有五连机会时直接取胜`, () => {
    const board = boardFrom(
      rows({
        6: '. . . . . O O O O . . . . . .',
        7: '. . . . X X X X . . . . . . .',
      }),
    )
    // 白方也有四子，但轮到黑方：应该直接成五而不是去挡
    const move = chooseMove(board, BLACK, level, seeded(1))
    assert.ok(
      (move.x === 3 || move.x === 8) && move.y === 7,
      `应在 (3,7) 或 (8,7) 成五，实际 ${JSON.stringify(move)}`,
    )
  })

  test(`[${level}] 对方冲四时必须挡住`, () => {
    const board = boardFrom(
      rows({
        3: '. . . . . . . . . . . X . . .',
        7: '. . . . O X X X X . . . . . .',
      }),
    )
    const move = chooseMove(board, WHITE, level, seeded(2))
    assert.deepEqual(move, { x: 9, y: 7 })
  })
}

for (const level of ['normal', 'hard'] as Level[]) {
  test(`[${level}] 会挡住对方的活三`, () => {
    const board = boardFrom(
      rows({
        7: '. . . . . X X X . . . . . . .',
        8: '. . . . . . O . . . . . . . .',
        9: '. . . . . . . O . . . . . . .',
      }),
    )
    const move = chooseMove(board, WHITE, level)
    assert.equal(move.y, 7, `应挡在第 7 行，实际 ${JSON.stringify(move)}`)
    assert.ok([3, 4, 8, 9].includes(move.x), `应挡在活三两端，实际 ${JSON.stringify(move)}`)
  })

  test(`[${level}] 能走出四三取胜`, () => {
    // 黑在 (7,7) 落子可同时形成横向冲四与纵向活三
    const board = boardFrom(
      rows({
        4: '. . . . . . . . . . . . . . .',
        5: '. . . . . . . X . . . . . . .',
        6: '. . . . . . . X . . . . . . .',
        7: '. . . O X X X . . . . . . . .',
        12: 'O . . . . . . . . . . . . . O',
      }),
    )
    const move = chooseMove(board, BLACK, level)
    assert.deepEqual(move, { x: 7, y: 7 })
  })
}

test('困难难度单步思考时间可控', () => {
  const game = new Game()
  const seq = [
    [7, 7], [8, 8], [8, 6], [6, 8], [9, 7], [7, 9], [6, 6], [9, 9], [10, 8],
  ]
  for (const [x, y] of seq) game.play(x, y)
  const start = Date.now()
  chooseMove(game.board, game.turn, 'hard')
  const elapsed = Date.now() - start
  assert.ok(elapsed < 3000, `耗时 ${elapsed}ms`)
})

/** 两个 AI 对弈一整局，返回胜者（和棋为 null） */
function selfPlay(black: Level, white: Level, seed: number): Stone | null {
  const game = new Game()
  const random = seeded(seed)
  // 开局随机走两步，让对局多样化
  game.play(7, 7)
  game.play(7 + Math.floor(random() * 3) - 1, 6)
  while (!game.isOver) {
    const level = game.turn === BLACK ? black : white
    const move = chooseMove(game.board, game.turn, level, random)
    assert.ok(game.play(move.x, move.y), `AI 给出了非法着法 ${JSON.stringify(move)}`)
  }
  return game.status.kind === 'win' ? game.status.winner : null
}

test('普通难度明显强于简单难度', () => {
  let wins = 0
  const games = 6
  for (let seed = 0; seed < games; seed++) {
    // 轮流执黑执白
    const normalIsBlack = seed % 2 === 0
    const winner = selfPlay(normalIsBlack ? 'normal' : 'easy', normalIsBlack ? 'easy' : 'normal', seed + 10)
    if (winner === (normalIsBlack ? BLACK : WHITE)) wins++
  }
  assert.ok(wins >= games - 1, `普通难度只赢了 ${wins}/${games} 局`)
})
