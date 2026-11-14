/**
 * Canvas 棋盘渲染：棋盘、坐标、星位、棋子、最后一手标记、获胜连线、悬停预览。
 * 自动适配高分屏（devicePixelRatio），尺寸由外部容器决定。
 */

import { BLACK, type Board, type GameStatus, type Point, type Stone } from '../core/board.ts'

export interface RenderState {
  board: Board
  status: GameStatus
  /** 悬停（或键盘光标）所在的交叉点 */
  cursor: Point | null
  /** 光标处预览棋子的颜色；null 表示不显示预览 */
  previewColor: Stone | null
  /** 是否显示键盘光标框 */
  showCursor: boolean
  showNumbers: boolean
}

const COLUMN_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DROP_MS = 160

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly size: number
  private readonly ctx: CanvasRenderingContext2D
  private cssSize = 0
  private dpr = 1
  private cell = 0
  private margin = 0
  private state: RenderState | null = null
  private animKey = ''
  private animStart = 0
  private frame = 0

  constructor(canvas: HTMLCanvasElement, size: number) {
    this.canvas = canvas
    this.size = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持 Canvas')
    this.ctx = ctx
  }

  /** 按容器尺寸重新设置画布分辨率 */
  resize(cssSize: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    if (cssSize === this.cssSize && dpr === this.dpr) return
    this.cssSize = cssSize
    this.dpr = dpr
    this.canvas.width = Math.round(cssSize * dpr)
    this.canvas.height = Math.round(cssSize * dpr)
    // 四周各留出约一格的空间放坐标
    this.cell = cssSize / (this.size - 1 + 2 * 1.05)
    this.margin = this.cell * 1.05
    if (this.state) this.draw(this.state)
  }

  /** 把鼠标 / 触摸坐标换算为最近的交叉点 */
  pointAt(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !this.cell) return null
    const scale = this.cssSize / rect.width
    const x = Math.round(((clientX - rect.left) * scale - this.margin) / this.cell)
    const y = Math.round(((clientY - rect.top) * scale - this.margin) / this.cell)
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null
    return { x, y }
  }

  /** 交叉点的坐标名称，如 H8 */
  static label(p: Point, size: number): string {
    return `${COLUMN_LABELS[p.x]}${size - p.y}`
  }

  draw(state: RenderState): void {
    this.state = state
    if (!this.cssSize) return
    cancelAnimationFrame(this.frame)

    const { ctx, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssSize, this.cssSize)

    this.drawWood()
    this.drawGrid()

    const { board } = state
    const last = board.lastMove
    const lastKey = last ? `${board.moveCount}:${last.x},${last.y}` : ''
    if (lastKey !== this.animKey) {
      this.animKey = lastKey
      this.animStart = performance.now()
    }
    const progress = Math.min(1, (performance.now() - this.animStart) / DROP_MS)

    board.history.forEach((m, index) => {
      const isLast = index === board.moveCount - 1
      // 最后一手有个轻微的「落下」动画
      const scale = isLast ? 0.82 + 0.18 * easeOutBack(progress) : 1
      this.drawStone(m.x, m.y, m.color, { scale })
    })

    if (state.status.kind === 'win') this.drawWinLine(state.status.line)

    if (state.showNumbers) {
      board.history.forEach((m, index) => this.drawNumber(m.x, m.y, m.color, index + 1, index === board.moveCount - 1))
    } else if (last) {
      this.drawLastMarker(last.x, last.y)
    }

    const { cursor } = state
    if (cursor && board.isEmpty(cursor.x, cursor.y) && state.previewColor) {
      this.drawStone(cursor.x, cursor.y, state.previewColor, { alpha: 0.42, shadow: false })
    }
    if (cursor && state.showCursor) this.drawCursor(cursor)

    if (progress < 1) this.frame = requestAnimationFrame(() => this.state && this.draw(this.state))
  }

  /* ------------------------------------------------------------------------ */

  private pos(i: number): number {
    return this.margin + i * this.cell
  }

  /** 让细线对齐到物理像素，避免模糊 */
  private snap(v: number, lineWidthPx: number): number {
    const offset = lineWidthPx % 2 === 1 ? 0.5 : 0
    return (Math.round(v * this.dpr - offset) + offset) / this.dpr
  }

  private drawWood(): void {
    const { ctx, cssSize: s } = this
    const g = ctx.createLinearGradient(0, 0, s, s)
    g.addColorStop(0, '#ecc98f')
    g.addColorStop(0.5, '#e2b778')
    g.addColorStop(1, '#d7a864')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)

    // 淡淡的木纹
    ctx.save()
    ctx.globalAlpha = 0.07
    ctx.strokeStyle = '#7a4b1c'
    ctx.lineWidth = 1
    for (let i = 0; i < 26; i++) {
      const y0 = (s / 26) * i + ((i * 37) % 11)
      ctx.beginPath()
      ctx.moveTo(0, y0)
      for (let x = 0; x <= s; x += s / 12) {
        ctx.lineTo(x, y0 + Math.sin(x / s * 6 + i) * s * 0.008)
      }
      ctx.stroke()
    }
    ctx.restore()

    const v = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.75)
    v.addColorStop(0, 'rgba(255, 240, 210, 0.18)')
    v.addColorStop(1, 'rgba(90, 50, 10, 0.12)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, s, s)
  }

  private drawGrid(): void {
    const { ctx, size, cell } = this
    const thin = Math.max(1, Math.round(this.dpr))
    const start = this.pos(0)
    const end = this.pos(size - 1)

    ctx.strokeStyle = 'rgba(58, 36, 14, 0.82)'
    ctx.lineWidth = thin / this.dpr
    ctx.beginPath()
    for (let i = 1; i < size - 1; i++) {
      const p = this.snap(this.pos(i), thin)
      ctx.moveTo(start, p)
      ctx.lineTo(end, p)
      ctx.moveTo(p, start)
      ctx.lineTo(p, end)
    }
    ctx.stroke()

    // 外框加粗
    const thick = thin * 2
    ctx.lineWidth = thick / this.dpr
    const a = this.snap(start, thick)
    const b = this.snap(end, thick)
    ctx.strokeRect(a, a, b - a, b - a)

    // 星位
    ctx.fillStyle = 'rgba(58, 36, 14, 0.9)'
    for (const [x, y] of starPoints(size)) {
      ctx.beginPath()
      ctx.arc(this.pos(x), this.pos(y), Math.max(2.5, cell * 0.1), 0, Math.PI * 2)
      ctx.fill()
    }

    // 坐标
    ctx.fillStyle = 'rgba(70, 44, 18, 0.75)'
    ctx.font = `600 ${Math.max(9, Math.round(cell * 0.32))}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const edge = this.margin * 0.48
    for (let i = 0; i < size; i++) {
      const p = this.pos(i)
      const col = COLUMN_LABELS[i]
      const row = String(size - i)
      ctx.fillText(col, p, edge)
      ctx.fillText(col, p, this.cssSize - edge)
      ctx.fillText(row, edge, p)
      ctx.fillText(row, this.cssSize - edge, p)
    }
  }

  private drawStone(x: number, y: number, color: Stone, opts: { scale?: number; alpha?: number; shadow?: boolean } = {}): void {
    const { ctx } = this
    const { scale = 1, alpha = 1, shadow = true } = opts
    const cx = this.pos(x)
    const cy = this.pos(y)
    const r = this.cell * 0.46 * scale

    ctx.save()
    ctx.globalAlpha = alpha
    if (shadow) {
      ctx.shadowColor = 'rgba(40, 20, 0, 0.45)'
      ctx.shadowBlur = this.cell * 0.14
      ctx.shadowOffsetX = this.cell * 0.04
      ctx.shadowOffsetY = this.cell * 0.07
    }
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r)
    if (color === BLACK) {
      g.addColorStop(0, '#77736e')
      g.addColorStop(0.35, '#2b2a28')
      g.addColorStop(1, '#0a0a0a')
    } else {
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.6, '#f1efea')
      g.addColorStop(1, '#c7c2b8')
    }
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawLastMarker(x: number, y: number): void {
    const { ctx } = this
    ctx.fillStyle = '#e5482f'
    ctx.beginPath()
    ctx.arc(this.pos(x), this.pos(y), this.cell * 0.11, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawNumber(x: number, y: number, color: Stone, n: number, isLast: boolean): void {
    const { ctx, cell } = this
    const digits = String(n).length
    const fontSize = cell * (digits >= 3 ? 0.3 : 0.38)
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isLast ? '#e5482f' : color === BLACK ? '#f4f1ea' : '#1d1b18'
    ctx.fillText(String(n), this.pos(x), this.pos(y) + fontSize * 0.04)
  }

  private drawWinLine(line: Point[]): void {
    const { ctx, cell } = this
    const first = line[0]
    const last = line[line.length - 1]

    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(229, 72, 47, 0.85)'
    ctx.lineWidth = cell * 0.12
    ctx.beginPath()
    ctx.moveTo(this.pos(first.x), this.pos(first.y))
    ctx.lineTo(this.pos(last.x), this.pos(last.y))
    ctx.stroke()

    ctx.lineWidth = Math.max(2, cell * 0.07)
    for (const p of line) {
      ctx.beginPath()
      ctx.arc(this.pos(p.x), this.pos(p.y), cell * 0.48, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawCursor(p: Point): void {
    const { ctx, cell } = this
    const cx = this.pos(p.x)
    const cy = this.pos(p.y)
    const h = cell * 0.5
    const arm = cell * 0.18
    ctx.save()
    ctx.strokeStyle = '#1f6feb'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = cx + sx * h
      const y = cy + sy * h
      ctx.moveTo(x - sx * arm, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y - sy * arm)
    }
    ctx.stroke()
    ctx.restore()
  }
}

function starPoints(size: number): [number, number][] {
  const c = Math.floor(size / 2)
  if (size < 9) return [[c, c]]
  const d = size >= 13 ? 3 : 2
  const far = size - 1 - d
  return [[d, d], [far, d], [d, far], [far, far], [c, c]]
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
