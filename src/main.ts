/**
 * 页面入口：把对局逻辑、AI 与界面连接起来。
 */

import { BLACK, colorName, Game, opponent, WHITE, type Point, type Stone } from './core/board.ts'
import { chooseMove, type Level } from './core/ai.ts'
import { BoardRenderer } from './ui/renderer.ts'

type Mode = 'pve' | 'pvp'
type Side = 'black' | 'white'

interface Settings {
  mode: Mode
  side: Side
  level: Level
  showNumbers: boolean
}

interface SaveData {
  settings: Settings
  moves: [number, number][]
}

const STORAGE_KEY = 'five-in-a-row:v2'
const DEFAULT_SETTINGS: Settings = { mode: 'pve', side: 'black', level: 'normal', showNumbers: false }
/** AI 至少「思考」这么久再落子，避免瞬间落子显得突兀 */
const AI_MIN_DELAY_MS = 380
const LEVEL_NAMES: Record<Level, string> = { easy: '简单', normal: '普通', hard: '困难' }

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`找不到元素 ${selector}`)
  return el
}

/* ------------------------------ 本地存储（失败时静默降级） ------------------------------ */

function loadSave(): Partial<SaveData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<SaveData>) : {}
  } catch {
    return {}
  }
}

function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* 隐私模式等情况下无法存储，忽略即可 */
  }
}

function sanitizeSettings(s: Partial<Settings> | undefined): Settings {
  const v = { ...DEFAULT_SETTINGS, ...s }
  return {
    mode: v.mode === 'pvp' ? 'pvp' : 'pve',
    side: v.side === 'white' ? 'white' : 'black',
    level: v.level === 'easy' || v.level === 'hard' ? v.level : 'normal',
    showNumbers: v.showNumbers === true,
  }
}

/* ------------------------------------ 应用 ------------------------------------ */

class App {
  private readonly game = new Game()
  private readonly renderer: BoardRenderer
  private settings: Settings
  private cursor: Point | null = null
  private keyboardCursor = false
  private thinking = false
  /** 每次取消 / 重新安排 AI 时自增，用于丢弃过期的 AI 结果 */
  private aiToken = 0
  private resultDismissed = false

  private readonly canvas = $<HTMLCanvasElement>('#board')
  private readonly statusStone = $('#status-stone')
  private readonly statusText = $('#status-text')
  private readonly statusSub = $('#status-sub')
  private readonly undoBtn = $<HTMLButtonElement>('#undo')
  private readonly restartBtn = $<HTMLButtonElement>('#restart')
  private readonly numbersToggle = $<HTMLInputElement>('#show-numbers')
  private readonly result = $('#result')
  private readonly resultTitle = $('#result-title')
  private readonly resultSub = $('#result-sub')
  private readonly announcer = $('#announcer')

  constructor() {
    this.renderer = new BoardRenderer(this.canvas, this.game.board.size)
    const save = loadSave()
    this.settings = sanitizeSettings(save.settings)
    if (Array.isArray(save.moves)) {
      this.game.replay(save.moves.filter((m) => Array.isArray(m)).map(([x, y]) => ({ x, y })))
      // 恢复的对局若已结束，不再弹出结果卡片
      this.resultDismissed = this.game.isOver
    }

    this.bindControls()
    this.bindBoard()
    this.observeSize()
    this.syncControls()
    this.update()
    this.scheduleAi()
  }

  /* ---------------------------------- 角色 ---------------------------------- */

  private get humanColor(): Stone {
    return this.settings.side === 'black' ? BLACK : WHITE
  }

  private get aiColor(): Stone | null {
    return this.settings.mode === 'pve' ? opponent(this.humanColor) : null
  }

  private get isHumanTurn(): boolean {
    return !this.game.isOver && !this.thinking && this.game.turn !== this.aiColor
  }

  /* ---------------------------------- 操作 ---------------------------------- */

  private play(p: Point): void {
    const move = this.game.play(p.x, p.y)
    if (!move) return
    if (this.game.isOver) this.resultDismissed = false
    this.announce(`${colorName(move.color)}落子 ${BoardRenderer.label(move, this.game.board.size)}`)
    this.update()
    this.scheduleAi()
  }

  private humanPlay(p: Point): void {
    if (this.isHumanTurn && this.game.canPlay(p.x, p.y)) this.play(p)
  }

  private undo(): void {
    if (!this.canUndo()) return
    this.cancelAi()
    if (this.settings.mode === 'pvp') {
      this.game.undo()
    } else {
      // 人机模式：一直退回到玩家自己的上一手
      let move
      do move = this.game.undo()
      while (move && move.color !== this.humanColor)
    }
    this.announce('已悔棋')
    this.update()
    this.scheduleAi()
  }

  private canUndo(): boolean {
    const history = this.game.board.history
    if (this.settings.mode === 'pvp') return history.length > 0
    return history.some((m) => m.color === this.humanColor)
  }

  private restart(): void {
    this.cancelAi()
    this.game.reset()
    this.resultDismissed = false
    this.announce('新的一局开始了')
    this.update()
    this.scheduleAi()
  }

  /* ----------------------------------- AI ----------------------------------- */

  private scheduleAi(): void {
    if (this.aiColor === null || this.game.isOver || this.game.turn !== this.aiColor || this.thinking) return
    const token = ++this.aiToken
    const color = this.aiColor
    const level = this.settings.level
    this.thinking = true
    this.update()

    const started = performance.now()
    // 先让浏览器把「思考中」画出来，再进行计算
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (token !== this.aiToken) return
        const move = chooseMove(this.game.board, color, level)
        const wait = Math.max(0, AI_MIN_DELAY_MS - (performance.now() - started))
        setTimeout(() => {
          if (token !== this.aiToken) return
          this.thinking = false
          this.play(move)
        }, wait)
      }, 0),
    )
  }

  private cancelAi(): void {
    this.aiToken++
    this.thinking = false
  }

  /* --------------------------------- 设置 ---------------------------------- */

  private changeSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.settings[key] === value) return
    const restartNeeded = key === 'mode' || key === 'side'
    const inProgress = !this.game.isOver && this.game.board.moveCount > 1
    if (restartNeeded && inProgress && !window.confirm('切换后将重新开始本局，确定吗？')) {
      this.syncControls()
      return
    }
    this.settings = { ...this.settings, [key]: value }
    this.syncControls()
    if (restartNeeded) this.restart()
    else this.update()
  }

  /* --------------------------------- 界面 ---------------------------------- */

  private bindControls(): void {
    document.querySelectorAll<HTMLElement>('[data-setting]').forEach((group) => {
      const key = group.dataset.setting as 'mode' | 'side' | 'level'
      group.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]')
        if (btn) this.changeSetting(key, btn.dataset.value as never)
      })
    })
    this.numbersToggle.addEventListener('change', () => this.changeSetting('showNumbers', this.numbersToggle.checked))
    this.undoBtn.addEventListener('click', () => this.undo())
    this.restartBtn.addEventListener('click', () => this.restart())
    $('#result-again').addEventListener('click', () => this.restart())
    $('#result-close').addEventListener('click', () => {
      this.resultDismissed = true
      this.update()
    })

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        this.undo()
      } else if (e.key === 'Escape' && this.game.isOver && !this.resultDismissed) {
        this.resultDismissed = true
        this.update()
      }
    })
  }

  private bindBoard(): void {
    const { canvas } = this

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.keyboardCursor = false
      this.setCursor(this.renderer.pointAt(e.clientX, e.clientY))
    })
    canvas.addEventListener('pointerleave', () => {
      if (!this.keyboardCursor) this.setCursor(null)
    })
    canvas.addEventListener('click', (e) => {
      const p = this.renderer.pointAt(e.clientX, e.clientY)
      if (p) this.humanPlay(p)
    })

    // 键盘：方向键移动光标，回车 / 空格落子
    canvas.addEventListener('keydown', (e) => {
      const size = this.game.board.size
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      }
      const clamp = (v: number) => Math.min(size - 1, Math.max(0, v))
      if (e.key in deltas) {
        e.preventDefault()
        this.keyboardCursor = true
        if (this.cursor) {
          const [dx, dy] = deltas[e.key]
          this.cursor = { x: clamp(this.cursor.x + dx), y: clamp(this.cursor.y + dy) }
        } else {
          // 第一次按方向键：光标出现在最后一手（或天元）
          const c = Math.floor(size / 2)
          const last = this.game.board.lastMove
          this.cursor = last ? { x: last.x, y: last.y } : { x: c, y: c }
        }
        this.draw()
      } else if ((e.key === 'Enter' || e.key === ' ') && this.cursor) {
        e.preventDefault()
        this.humanPlay(this.cursor)
      }
    })
    canvas.addEventListener('blur', () => {
      if (this.keyboardCursor) {
        this.keyboardCursor = false
        this.setCursor(null)
      }
    })
  }

  private observeSize(): void {
    const resize = () => this.renderer.resize(this.canvas.clientWidth)
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(this.canvas)
    else window.addEventListener('resize', resize)
    // 移动到另一块屏幕（DPR 变化）时也需要重新计算分辨率
    window.addEventListener('resize', resize)
    resize()
  }

  private setCursor(p: Point | null): void {
    const same = p === this.cursor || (p && this.cursor && p.x === this.cursor.x && p.y === this.cursor.y)
    if (same) return
    this.cursor = p
    this.draw()
  }

  private syncControls(): void {
    document.querySelectorAll<HTMLElement>('[data-setting]').forEach((group) => {
      const key = group.dataset.setting as 'mode' | 'side' | 'level'
      group.querySelectorAll<HTMLButtonElement>('button[data-value]').forEach((btn) => {
        const active = btn.dataset.value === this.settings[key]
        btn.classList.toggle('active', active)
        btn.setAttribute('aria-pressed', String(active))
      })
    })
    document.body.classList.toggle('mode-pvp', this.settings.mode === 'pvp')
    this.numbersToggle.checked = this.settings.showNumbers
  }

  private draw(): void {
    const preview = this.isHumanTurn ? this.game.turn : null
    this.renderer.draw({
      board: this.game.board,
      status: this.game.status,
      cursor: this.cursor,
      previewColor: preview,
      showCursor: this.keyboardCursor,
      showNumbers: this.settings.showNumbers,
    })
    this.canvas.style.cursor = preview && this.cursor && this.game.board.isEmpty(this.cursor.x, this.cursor.y) ? 'pointer' : 'default'
  }

  /** 状态变化后统一刷新界面并保存 */
  private update(): void {
    const { game, settings } = this
    const status = game.status
    const pve = settings.mode === 'pve'
    const moves = game.board.moveCount

    let stone: Stone = game.turn
    let text: string
    let sub: string
    if (status.kind === 'win') {
      stone = status.winner
      text = pve ? (status.winner === this.humanColor ? '你赢了！' : '电脑获胜') : `${colorName(status.winner)}获胜！`
      sub = `共 ${moves} 手`
    } else if (status.kind === 'draw') {
      text = '平局'
      sub = '棋盘已下满'
    } else if (this.thinking) {
      text = '电脑思考中…'
      sub = `第 ${moves + 1} 手 · ${LEVEL_NAMES[settings.level]}`
    } else if (pve) {
      text = '轮到你了'
      sub = `你执${this.humanColor === BLACK ? '黑' : '白'} · 第 ${moves + 1} 手`
    } else {
      text = `${colorName(game.turn)}落子`
      sub = `第 ${moves + 1} 手`
    }

    this.statusText.textContent = text
    this.statusSub.textContent = sub
    this.statusStone.className = `stone ${stone === BLACK ? 'black' : 'white'}`
    this.statusStone.classList.toggle('pulse', this.thinking)
    document.body.classList.toggle('thinking', this.thinking)

    this.undoBtn.disabled = !this.canUndo()
    this.restartBtn.disabled = moves === 0 && !this.thinking

    const showResult = game.isOver && !this.resultDismissed
    this.result.hidden = !showResult
    if (showResult) {
      this.resultTitle.textContent = text
      this.resultSub.textContent =
        status.kind === 'win' ? `${colorName(status.winner)}五子连珠 · 共 ${moves} 手` : '双方都没能连成五子'
      this.result.dataset.tone = status.kind === 'win' && pve && status.winner !== this.humanColor ? 'lose' : 'win'
      // 卡片放在获胜连线的另一侧，避免挡住连线
      let place = 'center'
      if (status.kind === 'win') {
        const avgY = status.line.reduce((sum, p) => sum + p.y, 0) / status.line.length
        place = avgY < (game.board.size - 1) / 2 ? 'bottom' : 'top'
      }
      this.result.dataset.place = place
    }
    if (game.isOver) this.announce(text)

    this.draw()
    writeSave({ settings, moves: game.board.history.map((m) => [m.x, m.y]) })
  }

  private announce(message: string): void {
    this.announcer.textContent = message
  }
}

new App()
