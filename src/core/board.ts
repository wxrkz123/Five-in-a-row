/**
 * 棋盘与对局规则（纯逻辑，不依赖 DOM，便于测试）
 *
 * 坐标约定：x 为列（0 ~ size-1，从左到右），y 为行（0 ~ size-1，从上到下）。
 */

export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export type Stone = typeof BLACK | typeof WHITE
export type Cell = typeof EMPTY | Stone

export interface Point {
  x: number
  y: number
}

export interface Move extends Point {
  color: Stone
}

export type GameStatus =
  | { kind: 'playing' }
  | { kind: 'win'; winner: Stone; line: Point[] }
  | { kind: 'draw' }

/** 需要检查的四条直线方向：横、竖、主对角线、副对角线 */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

export const DEFAULT_SIZE = 15
export const WIN_LENGTH = 5

export const opponent = (color: Stone): Stone => (color === BLACK ? WHITE : BLACK)

export const colorName = (color: Stone): string => (color === BLACK ? '黑方' : '白方')

export class Board {
  readonly size: number
  private readonly cells: Uint8Array
  private readonly moves: Move[] = []

  constructor(size = DEFAULT_SIZE) {
    if (!Number.isInteger(size) || size < WIN_LENGTH) {
      throw new RangeError(`棋盘大小至少为 ${WIN_LENGTH}`)
    }
    this.size = size
    this.cells = new Uint8Array(size * size)
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size
  }

  get(x: number, y: number): Cell {
    return this.cells[y * this.size + x] as Cell
  }

  isEmpty(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.get(x, y) === EMPTY
  }

  /** 已落子的序列（只读副本） */
  get history(): readonly Move[] {
    return this.moves
  }

  get moveCount(): number {
    return this.moves.length
  }

  get lastMove(): Move | undefined {
    return this.moves[this.moves.length - 1]
  }

  isFull(): boolean {
    return this.moves.length === this.size * this.size
  }

  place(x: number, y: number, color: Stone): Move {
    if (!this.isEmpty(x, y)) {
      throw new Error(`(${x}, ${y}) 不能落子`)
    }
    this.cells[y * this.size + x] = color
    const move: Move = { x, y, color }
    this.moves.push(move)
    return move
  }

  undo(): Move | undefined {
    const move = this.moves.pop()
    if (move) this.cells[move.y * this.size + move.x] = EMPTY
    return move
  }

  clear(): void {
    this.cells.fill(EMPTY)
    this.moves.length = 0
  }

  /**
   * 以 (x, y) 处的棋子为中心，沿四个方向分别向两侧延伸统计同色棋子。
   * 任一方向连续同色棋子 ≥ 5 时返回这条连线（按顺序排列），否则返回 null。
   */
  findWinningLine(x: number, y: number): Point[] | null {
    const color = this.get(x, y)
    if (color === EMPTY) return null

    for (const [dx, dy] of DIRECTIONS) {
      const line: Point[] = [{ x, y }]
      for (const sign of [-1, 1]) {
        let cx = x + dx * sign
        let cy = y + dy * sign
        while (this.inBounds(cx, cy) && this.get(cx, cy) === color) {
          if (sign < 0) line.unshift({ x: cx, y: cy })
          else line.push({ x: cx, y: cy })
          cx += dx * sign
          cy += dy * sign
        }
      }
      if (line.length >= WIN_LENGTH) return line
    }
    return null
  }
}

/**
 * 一局对弈：在棋盘之上维护轮次与胜负状态。
 * 黑方先行；采用无禁手规则，五子及以上连线即获胜。
 */
export class Game {
  readonly board: Board
  private _status: GameStatus = { kind: 'playing' }

  constructor(size = DEFAULT_SIZE) {
    this.board = new Board(size)
  }

  get status(): GameStatus {
    return this._status
  }

  get isOver(): boolean {
    return this._status.kind !== 'playing'
  }

  /** 当前轮到哪一方 */
  get turn(): Stone {
    return this.board.moveCount % 2 === 0 ? BLACK : WHITE
  }

  canPlay(x: number, y: number): boolean {
    return !this.isOver && this.board.isEmpty(x, y)
  }

  /** 落子；非法或对局已结束时返回 null */
  play(x: number, y: number): Move | null {
    if (!this.canPlay(x, y)) return null
    const move = this.board.place(x, y, this.turn)
    const line = this.board.findWinningLine(x, y)
    if (line) this._status = { kind: 'win', winner: move.color, line }
    else if (this.board.isFull()) this._status = { kind: 'draw' }
    return move
  }

  /** 悔一步棋，并恢复为对弈中状态 */
  undo(): Move | undefined {
    const move = this.board.undo()
    if (move) this._status = { kind: 'playing' }
    return move
  }

  reset(): void {
    this.board.clear()
    this._status = { kind: 'playing' }
  }

  /** 按顺序重放一组着法（用于恢复存档），遇到非法着法即停止 */
  replay(points: readonly Point[]): void {
    this.reset()
    for (const p of points) {
      if (!this.play(p.x, p.y)) break
    }
  }
}
