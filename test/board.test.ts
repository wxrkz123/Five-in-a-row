import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLACK, Board, Game, WHITE } from '../src/core/board.ts'

/** 依次落子：黑走 blacks[k]，白走 whites[k] */
function playAlternating(game: Game, blacks: [number, number][], whites: [number, number][]): void {
  for (let k = 0; k < blacks.length; k++) {
    game.play(...blacks[k])
    if (whites[k]) game.play(...whites[k])
  }
}

test('黑方先行，双方交替落子', () => {
  const game = new Game()
  assert.equal(game.turn, BLACK)
  game.play(7, 7)
  assert.equal(game.turn, WHITE)
  assert.equal(game.board.get(7, 7), BLACK)
})

test('不能在已有棋子的位置落子', () => {
  const game = new Game()
  game.play(7, 7)
  assert.equal(game.play(7, 7), null)
  assert.equal(game.board.moveCount, 1)
})

test('不能落在棋盘外', () => {
  const game = new Game()
  assert.equal(game.play(-1, 0), null)
  assert.equal(game.play(15, 3), null)
})

test('横向五连获胜', () => {
  const game = new Game()
  playAlternating(game, [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7]], [[0, 0], [1, 0], [2, 0], [3, 0]])
  assert.equal(game.status.kind, 'win')
  assert.equal(game.status.kind === 'win' && game.status.winner, BLACK)
})

test('最后一子落在中间也能判定获胜（旧版的 bug）', () => {
  const game = new Game()
  // 黑：●●_●● 再补中间
  playAlternating(game, [[3, 5], [4, 5], [6, 5], [7, 5], [5, 5]], [[0, 0], [0, 2], [0, 4], [0, 6]])
  assert.equal(game.status.kind, 'win')
  if (game.status.kind === 'win') {
    assert.deepEqual(
      game.status.line.map((p) => p.x),
      [3, 4, 5, 6, 7],
    )
  }
})

test('竖向、主对角、副对角五连均可获胜', () => {
  const lines: [number, number][][] = [
    [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6]],
    [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
    [[10, 2], [9, 3], [8, 4], [7, 5], [6, 6]],
  ]
  for (const blacks of lines) {
    const game = new Game()
    playAlternating(game, blacks, [[14, 0], [14, 2], [14, 4], [14, 6]])
    assert.equal(game.status.kind, 'win', JSON.stringify(blacks))
  }
})

test('四子不算获胜，被隔断的五子也不算', () => {
  const game = new Game()
  // 黑 ●●●● 被白子隔开后再在另一侧落一子
  playAlternating(game, [[0, 0], [1, 0], [2, 0], [3, 0], [5, 0]], [[4, 0], [0, 5], [0, 6], [0, 7]])
  assert.equal(game.status.kind, 'playing')
})

test('长连（六子）也算获胜', () => {
  const game = new Game()
  playAlternating(game, [[0, 9], [1, 9], [2, 9], [4, 9], [5, 9], [3, 9]], [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]])
  assert.equal(game.status.kind, 'win')
  if (game.status.kind === 'win') assert.equal(game.status.line.length, 6)
})

test('分出胜负后不能继续落子', () => {
  const game = new Game()
  playAlternating(game, [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7]], [[0, 0], [1, 0], [2, 0], [3, 0]])
  assert.equal(game.play(10, 10), null)
})

test('悔棋恢复棋盘与对局状态', () => {
  const game = new Game()
  playAlternating(game, [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7]], [[0, 0], [1, 0], [2, 0], [3, 0]])
  assert.equal(game.isOver, true)
  const undone = game.undo()
  assert.deepEqual(undone, { x: 4, y: 7, color: BLACK })
  assert.equal(game.isOver, false)
  assert.equal(game.turn, BLACK)
  assert.equal(game.board.isEmpty(4, 7), true)
})

test('棋盘下满且无人获胜为和棋', () => {
  // 5×5 小棋盘：按列方向交替排列，任何方向都连不成五
  const game = new Game(5)
  const order: [number, number][] = []
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) order.push([x, y])
  // 以 2 行为周期翻转颜色，避免形成五连
  const pattern = (x: number, y: number) => ((x + Math.floor(y / 2) * 1 + (y % 2) * 2) % 2 === 0 ? BLACK : WHITE)
  const blacks = order.filter(([x, y]) => pattern(x, y) === BLACK)
  const whites = order.filter(([x, y]) => pattern(x, y) === WHITE)
  // 黑方多一子
  const [more, less] = blacks.length >= whites.length ? [blacks, whites] : [whites, blacks]
  assert.equal(more.length, 13)
  playAlternating(game, more, less)
  assert.equal(game.board.isFull(), true)
  assert.equal(game.status.kind, 'draw')
})

test('replay 可以还原对局', () => {
  const game = new Game()
  game.replay([
    { x: 7, y: 7 },
    { x: 8, y: 8 },
    { x: 7, y: 8 },
  ])
  assert.equal(game.board.moveCount, 3)
  assert.equal(game.board.get(8, 8), WHITE)
  assert.equal(game.turn, WHITE)
})

test('棋盘大小校验', () => {
  assert.throws(() => new Board(4))
})
