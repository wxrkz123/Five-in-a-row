/**
 * 五子棋 AI
 *
 * 1. 棋型识别：以某点为中心，取一条直线上前后各 4 格（共 9 格）。中心之外的 8 格各有
 *    「空 / 己方 / 阻挡（对方棋子或出界）」三种状态，共 3^8 = 6561 种组合。
 *    启动时一次性算出每种组合对应的棋型（连五、活四、冲四、活三、眠三、活二、眠二），
 *    运行时只需查表。
 * 2. 落点评估：某点对己方的价值（进攻）+ 对对方的价值（防守），再识别双四、四三、双三等组合。
 * 3. 搜索：在评估最高的若干候选点上做带 α-β 剪枝的极大极小搜索（迭代加深 + 限时），
 *    并对「必须挡五」的强制着法做延伸，以发现杀棋或避开对方的组合杀。
 */

import { Board, DIRECTIONS, EMPTY, type Point, type Stone } from './board.ts'

export type Level = 'easy' | 'normal' | 'hard'

/* -------------------------------------------------------------------------- */
/*                                   棋型表                                   */
/* -------------------------------------------------------------------------- */

const NONE = 0
const SLEEP_TWO = 1
const LIVE_TWO = 2
const SLEEP_THREE = 3
const LIVE_THREE = 4
const FOUR = 5
const LIVE_FOUR = 6
const FIVE = 7

/** 编码中每一位的取值 */
const D_EMPTY = 0
const D_OWN = 1
const D_BLOCK = 2

const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187]
const CODES = 6561

/** 编码第 slot 位（0~7）对应 9 格中的第几格（跳过中心第 4 格） */
const cellOfSlot = (slot: number): number => (slot < 4 ? slot : slot + 1)

function decode(code: number): number[] {
  const cells = new Array<number>(9)
  cells[4] = D_OWN
  for (let slot = 0; slot < 8; slot++) {
    cells[cellOfSlot(slot)] = code % 3
    code = Math.floor(code / 3)
  }
  return cells
}

/** 经过中心的己方连续棋子数 */
function runThroughCenter(cells: number[]): number {
  let n = 1
  for (let i = 3; i >= 0 && cells[i] === D_OWN; i--) n++
  for (let i = 5; i < 9 && cells[i] === D_OWN; i++) n++
  return n
}

/** 再下一子即可成五的空位数量（成五必须经过中心） */
function countFivePoints(cells: number[]): number {
  let count = 0
  for (let i = 0; i < 9; i++) {
    if (cells[i] !== D_EMPTY) continue
    cells[i] = D_OWN
    if (runThroughCenter(cells) >= 5) count++
    cells[i] = D_EMPTY
  }
  return count
}

function buildShapeTable(): Uint8Array {
  const memo = new Int8Array(CODES).fill(-1)

  const shapeOf = (code: number): number => {
    if (memo[code] >= 0) return memo[code]
    const cells = decode(code)
    let shape = NONE
    if (runThroughCenter(cells) >= 5) {
      shape = FIVE
    } else {
      const fivePoints = countFivePoints(cells)
      if (fivePoints >= 2) shape = LIVE_FOUR // 活四（同一条线上的「双四」也视为活四）
      else if (fivePoints === 1) shape = FOUR // 冲四
      else {
        // 再走一步能形成什么，决定当前是几
        for (let slot = 0; slot < 8; slot++) {
          if (cells[cellOfSlot(slot)] !== D_EMPTY) continue
          const next = shapeOf(code + POW3[slot])
          if (next === LIVE_FOUR) shape = Math.max(shape, LIVE_THREE)
          else if (next === FOUR) shape = Math.max(shape, SLEEP_THREE)
          else if (next === LIVE_THREE) shape = Math.max(shape, LIVE_TWO)
          else if (next === SLEEP_THREE) shape = Math.max(shape, SLEEP_TWO)
        }
      }
    }
    memo[code] = shape
    return shape
  }

  const table = new Uint8Array(CODES)
  for (let code = 0; code < CODES; code++) table[code] = shapeOf(code)
  return table
}

const SHAPES = buildShapeTable()

/* -------------------------------------------------------------------------- */
/*                                   评分                                     */
/* -------------------------------------------------------------------------- */

/** 落点评分（某方在该点落子后形成的棋型价值） */
export const SCORE = {
  FIVE: 10_000_000,
  /** 活四 / 双四：对方无法同时防守，下一手必成五 */
  LIVE_FOUR: 1_000_000,
  /** 四三：冲四的同时形成活三 */
  FOUR_THREE: 500_000,
  /** 双活三 */
  DOUBLE_THREE: 100_000,
  FOUR: 2_000,
  LIVE_THREE: 1_000,
  SLEEP_THREE: 150,
  LIVE_TWO: 120,
  SLEEP_TWO: 20,
} as const

/** 局面静态评估中每颗棋子在每个方向上的棋型价值 */
const EVAL_VALUE = [0, 2, 12, 15, 120, 150, 6_000, 100_000]

const WIN_SCORE = 100_000_000
const ATTACK_WEIGHT = 1.1

interface Candidate {
  i: number
  /** 进攻分：己方在此落子的价值 */
  a: number
  /** 防守分：对方在此落子的价值 */
  d: number
  /** 排序用的综合分 */
  s: number
}

type GenKind = 'win' | 'block' | 'win4' | 'normal'

const LEVELS: Record<Level, { maxDepth: number; timeMs: number; rootWidth: number; width: number }> = {
  easy: { maxDepth: 0, timeMs: 0, rootWidth: 8, width: 8 },
  normal: { maxDepth: 4, timeMs: 500, rootWidth: 10, width: 8 },
  hard: { maxDepth: 8, timeMs: 1500, rootWidth: 16, width: 10 },
}

const MAX_PLY = 24

class Timeout extends Error {}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/* -------------------------------------------------------------------------- */
/*                                   引擎                                     */
/* -------------------------------------------------------------------------- */

class Engine {
  private readonly n: number
  private readonly cells: Uint8Array
  /** 周围两格内的棋子数，>0 才作为候选点 */
  private readonly near: Uint16Array
  private readonly stones: number[] = []
  private deadline = Infinity
  private nodes = 0

  constructor(board: Board) {
    this.n = board.size
    this.cells = new Uint8Array(this.n * this.n)
    this.near = new Uint16Array(this.n * this.n)
    for (const m of board.history) this.place(m.y * this.n + m.x, m.color)
  }

  get stoneCount(): number {
    return this.stones.length
  }

  place(i: number, color: number): void {
    this.cells[i] = color
    this.stones.push(i)
    this.touch(i, 1)
  }

  remove(i: number): void {
    this.cells[i] = EMPTY
    this.stones.pop()
    this.touch(i, -1)
  }

  private touch(i: number, delta: number): void {
    const n = this.n
    const x = i % n
    const y = (i - x) / n
    for (let yy = Math.max(0, y - 2); yy <= Math.min(n - 1, y + 2); yy++) {
      for (let xx = Math.max(0, x - 2); xx <= Math.min(n - 1, x + 2); xx++) {
        this.near[yy * n + xx] += delta
      }
    }
  }

  /** 以 (x, y) 为中心、沿 (dx, dy) 方向的 8 格编码（从 color 的视角） */
  private lineCode(x: number, y: number, dx: number, dy: number, color: number): number {
    const n = this.n
    let code = 0
    for (let slot = 0; slot < 8; slot++) {
      const k = slot < 4 ? slot - 4 : slot - 3
      const cx = x + k * dx
      const cy = y + k * dy
      let digit = D_BLOCK
      if (cx >= 0 && cy >= 0 && cx < n && cy < n) {
        const c = this.cells[cy * n + cx]
        digit = c === EMPTY ? D_EMPTY : c === color ? D_OWN : D_BLOCK
      }
      code += digit * POW3[slot]
    }
    return code
  }

  /** color 在空点 (x, y) 落子的价值 */
  pointScore(x: number, y: number, color: number): number {
    let fours = 0
    let liveThrees = 0
    let score = 0
    for (const [dx, dy] of DIRECTIONS) {
      switch (SHAPES[this.lineCode(x, y, dx, dy, color)]) {
        case FIVE:
          return SCORE.FIVE
        case LIVE_FOUR:
          fours += 2
          break
        case FOUR:
          fours++
          score += SCORE.FOUR
          break
        case LIVE_THREE:
          liveThrees++
          score += SCORE.LIVE_THREE
          break
        case SLEEP_THREE:
          score += SCORE.SLEEP_THREE
          break
        case LIVE_TWO:
          score += SCORE.LIVE_TWO
          break
        case SLEEP_TWO:
          score += SCORE.SLEEP_TWO
          break
      }
    }
    if (fours >= 2) return SCORE.LIVE_FOUR
    if (fours === 1 && liveThrees > 0) return SCORE.FOUR_THREE
    if (liveThrees >= 2) return SCORE.DOUBLE_THREE
    return score
  }

  private candidates(side: number, defenseWeight = 1): Candidate[] {
    const n = this.n
    const opp = 3 - side
    const center = (n - 1) / 2
    const list: Candidate[] = []
    for (let i = 0; i < n * n; i++) {
      if (this.cells[i] !== EMPTY || this.near[i] === 0) continue
      const x = i % n
      const y = (i - x) / n
      const a = this.pointScore(x, y, side)
      const d = this.pointScore(x, y, opp)
      // 越靠近中心略加分，仅用于打破平局
      const centrality = 7 - Math.min(7, Math.max(Math.abs(x - center), Math.abs(y - center)))
      list.push({ i, a, d, s: a * ATTACK_WEIGHT + d * defenseWeight + centrality })
    }
    return list
  }

  /**
   * 生成候选着法，并识别必须立即处理的局面：
   * - win：己方可直接成五
   * - block：对方下一手可成五，只能去挡
   * - win4：己方可走出活四 / 双四，必胜
   * - normal：按综合分排序后取前 width 个
   */
  generate(side: number, width: number): { kind: GenKind; moves: Candidate[] } {
    const list = this.candidates(side)
    const blocks: Candidate[] = []
    let myWin: Candidate | null = null
    let oppThreat = false
    for (const c of list) {
      if (c.a >= SCORE.FIVE) return { kind: 'win', moves: [c] }
      if (c.d >= SCORE.FIVE) blocks.push(c)
      if (c.a >= SCORE.LIVE_FOUR && (!myWin || c.a > myWin.a)) myWin = c
      if (c.d >= SCORE.FOUR_THREE) oppThreat = true
    }
    if (blocks.length) return { kind: 'block', moves: blocks }
    if (myWin) return { kind: 'win4', moves: [myWin] }

    // 对方有活三 / 冲四活三等威胁时，只考虑防守点或己方能形成冲四的反击点
    const pool = oppThreat ? list.filter((c) => c.d >= SCORE.FOUR_THREE || c.a >= SCORE.FOUR) : list
    pool.sort((p, q) => q.s - p.s)
    return { kind: 'normal', moves: pool.length > width ? pool.slice(0, width) : pool }
  }

  /** 静态评估：从 side 的视角看当前局面 */
  private evaluate(side: number): number {
    const n = this.n
    let total = 0
    for (const i of this.stones) {
      const color = this.cells[i]
      const x = i % n
      const y = (i - x) / n
      let v = 0
      for (const [dx, dy] of DIRECTIONS) v += EVAL_VALUE[SHAPES[this.lineCode(x, y, dx, dy, color)]]
      total += color === side ? v : -v
    }
    return total
  }

  private negamax(side: number, depth: number, alpha: number, beta: number, ply: number, width: number): number {
    if ((++this.nodes & 255) === 0 && now() > this.deadline) throw new Timeout()

    const { kind, moves } = this.generate(side, width)
    if (moves.length === 0) return 0 // 棋盘已满，和棋
    if (kind === 'win') return WIN_SCORE - ply
    if (kind === 'win4') return WIN_SCORE - ply - 2
    if (kind === 'block' && moves.length > 1) return -(WIN_SCORE - ply - 1) // 两个成五点，挡不住

    // 被迫挡五时不消耗深度（强制着法延伸）
    const forced = kind === 'block'
    if ((depth <= 0 && !forced) || ply >= MAX_PLY) return this.evaluate(side)

    let best = -Infinity
    for (const m of moves) {
      this.place(m.i, side)
      const v = -this.negamax(3 - side, forced ? depth : depth - 1, -beta, -alpha, ply + 1, width)
      this.remove(m.i)
      if (v > best) best = v
      if (v > alpha) alpha = v
      if (alpha >= beta) break
    }
    return best
  }

  /** 迭代加深搜索，超时则返回上一轮完整搜索的结果 */
  search(side: number, root: Candidate[], level: (typeof LEVELS)[Level]): number {
    this.deadline = now() + level.timeMs
    this.nodes = 0
    let order = root.slice()
    let bestIndex = order[0].i

    for (let depth = 2; depth <= level.maxDepth; depth += 2) {
      let alpha = -Infinity
      let bestHere = order[0]
      const scores = new Map<number, number>()
      try {
        for (const m of order) {
          this.place(m.i, side)
          const v = -this.negamax(3 - side, depth - 1, -Infinity, -alpha, 1, level.width)
          this.remove(m.i)
          scores.set(m.i, v)
          if (v > alpha) {
            alpha = v
            bestHere = m
          }
        }
      } catch (e) {
        if (e instanceof Timeout) break
        throw e
      }
      bestIndex = bestHere.i
      if (alpha >= WIN_SCORE - MAX_PLY - 2) break // 已找到必胜
      // 下一轮优先搜索本轮表现好的着法，提高剪枝效率
      order = order.slice().sort((p, q) => (scores.get(q.i) ?? -Infinity) - (scores.get(p.i) ?? -Infinity))
    }
    return bestIndex
  }

  /** 简单难度：只看一步，偶尔忽略防守，并带有随机性 */
  pickCasual(side: number, random: () => number): number {
    const list = this.candidates(side, random() < 0.3 ? 0.05 : 0.6)
    let best = list[0]
    let bestScore = -Infinity
    for (const c of list) {
      const s = c.s * (0.75 + random() * 0.5)
      if (s > bestScore) {
        bestScore = s
        best = c
      }
    }
    return best.i
  }
}

/**
 * 为 color 方计算下一手。
 * @param random 随机数生成器（测试时可注入固定序列）
 */
export function chooseMove(board: Board, color: Stone, level: Level = 'normal', random: () => number = Math.random): Point {
  const n = board.size
  const engine = new Engine(board)
  const toPoint = (i: number): Point => ({ x: i % n, y: Math.floor(i / n) })

  if (engine.stoneCount === 0) {
    const c = Math.floor(n / 2)
    return { x: c, y: c }
  }

  const settings = LEVELS[level]
  const { kind, moves } = engine.generate(color, settings.rootWidth)
  if (moves.length === 0) throw new Error('棋盘已满')

  // 成五、挡五、活四这类局面无需搜索
  if (kind !== 'normal' || moves.length === 1) return toPoint(moves[0].i)
  if (level === 'easy') return toPoint(engine.pickCasual(color, random))
  return toPoint(engine.search(color, moves, settings))
}

/** 仅用于测试：计算某点对某方的落子价值 */
export function scorePoint(board: Board, p: Point, color: Stone): number {
  return new Engine(board).pointScore(p.x, p.y, color)
}
