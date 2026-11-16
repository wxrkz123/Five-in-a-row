"use strict";
(() => {
  // src/core/board.ts
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];
  var DEFAULT_SIZE = 15;
  var WIN_LENGTH = 5;
  var opponent = (color) => color === BLACK ? WHITE : BLACK;
  var colorName = (color) => color === BLACK ? "\u9ED1\u65B9" : "\u767D\u65B9";
  var Board = class {
    constructor(size = DEFAULT_SIZE) {
      this.moves = [];
      if (!Number.isInteger(size) || size < WIN_LENGTH) {
        throw new RangeError(`\u68CB\u76D8\u5927\u5C0F\u81F3\u5C11\u4E3A ${WIN_LENGTH}`);
      }
      this.size = size;
      this.cells = new Uint8Array(size * size);
    }
    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.size && y < this.size;
    }
    get(x, y) {
      return this.cells[y * this.size + x];
    }
    isEmpty(x, y) {
      return this.inBounds(x, y) && this.get(x, y) === EMPTY;
    }
    /** 已落子的序列（只读副本） */
    get history() {
      return this.moves;
    }
    get moveCount() {
      return this.moves.length;
    }
    get lastMove() {
      return this.moves[this.moves.length - 1];
    }
    isFull() {
      return this.moves.length === this.size * this.size;
    }
    place(x, y, color) {
      if (!this.isEmpty(x, y)) {
        throw new Error(`(${x}, ${y}) \u4E0D\u80FD\u843D\u5B50`);
      }
      this.cells[y * this.size + x] = color;
      const move = { x, y, color };
      this.moves.push(move);
      return move;
    }
    undo() {
      const move = this.moves.pop();
      if (move) this.cells[move.y * this.size + move.x] = EMPTY;
      return move;
    }
    clear() {
      this.cells.fill(EMPTY);
      this.moves.length = 0;
    }
    /**
     * 以 (x, y) 处的棋子为中心，沿四个方向分别向两侧延伸统计同色棋子。
     * 任一方向连续同色棋子 ≥ 5 时返回这条连线（按顺序排列），否则返回 null。
     */
    findWinningLine(x, y) {
      const color = this.get(x, y);
      if (color === EMPTY) return null;
      for (const [dx, dy] of DIRECTIONS) {
        const line = [{ x, y }];
        for (const sign of [-1, 1]) {
          let cx = x + dx * sign;
          let cy = y + dy * sign;
          while (this.inBounds(cx, cy) && this.get(cx, cy) === color) {
            if (sign < 0) line.unshift({ x: cx, y: cy });
            else line.push({ x: cx, y: cy });
            cx += dx * sign;
            cy += dy * sign;
          }
        }
        if (line.length >= WIN_LENGTH) return line;
      }
      return null;
    }
  };
  var Game = class {
    constructor(size = DEFAULT_SIZE) {
      this._status = { kind: "playing" };
      this.board = new Board(size);
    }
    get status() {
      return this._status;
    }
    get isOver() {
      return this._status.kind !== "playing";
    }
    /** 当前轮到哪一方 */
    get turn() {
      return this.board.moveCount % 2 === 0 ? BLACK : WHITE;
    }
    canPlay(x, y) {
      return !this.isOver && this.board.isEmpty(x, y);
    }
    /** 落子；非法或对局已结束时返回 null */
    play(x, y) {
      if (!this.canPlay(x, y)) return null;
      const move = this.board.place(x, y, this.turn);
      const line = this.board.findWinningLine(x, y);
      if (line) this._status = { kind: "win", winner: move.color, line };
      else if (this.board.isFull()) this._status = { kind: "draw" };
      return move;
    }
    /** 悔一步棋，并恢复为对弈中状态 */
    undo() {
      const move = this.board.undo();
      if (move) this._status = { kind: "playing" };
      return move;
    }
    reset() {
      this.board.clear();
      this._status = { kind: "playing" };
    }
    /** 按顺序重放一组着法（用于恢复存档），遇到非法着法即停止 */
    replay(points) {
      this.reset();
      for (const p of points) {
        if (!this.play(p.x, p.y)) break;
      }
    }
  };

  // src/core/ai.ts
  var NONE = 0;
  var SLEEP_TWO = 1;
  var LIVE_TWO = 2;
  var SLEEP_THREE = 3;
  var LIVE_THREE = 4;
  var FOUR = 5;
  var LIVE_FOUR = 6;
  var FIVE = 7;
  var D_EMPTY = 0;
  var D_OWN = 1;
  var D_BLOCK = 2;
  var POW3 = [1, 3, 9, 27, 81, 243, 729, 2187];
  var CODES = 6561;
  var cellOfSlot = (slot) => slot < 4 ? slot : slot + 1;
  function decode(code) {
    const cells = new Array(9);
    cells[4] = D_OWN;
    for (let slot = 0; slot < 8; slot++) {
      cells[cellOfSlot(slot)] = code % 3;
      code = Math.floor(code / 3);
    }
    return cells;
  }
  function runThroughCenter(cells) {
    let n = 1;
    for (let i = 3; i >= 0 && cells[i] === D_OWN; i--) n++;
    for (let i = 5; i < 9 && cells[i] === D_OWN; i++) n++;
    return n;
  }
  function countFivePoints(cells) {
    let count = 0;
    for (let i = 0; i < 9; i++) {
      if (cells[i] !== D_EMPTY) continue;
      cells[i] = D_OWN;
      if (runThroughCenter(cells) >= 5) count++;
      cells[i] = D_EMPTY;
    }
    return count;
  }
  function buildShapeTable() {
    const memo = new Int8Array(CODES).fill(-1);
    const shapeOf = (code) => {
      if (memo[code] >= 0) return memo[code];
      const cells = decode(code);
      let shape = NONE;
      if (runThroughCenter(cells) >= 5) {
        shape = FIVE;
      } else {
        const fivePoints = countFivePoints(cells);
        if (fivePoints >= 2) shape = LIVE_FOUR;
        else if (fivePoints === 1) shape = FOUR;
        else {
          for (let slot = 0; slot < 8; slot++) {
            if (cells[cellOfSlot(slot)] !== D_EMPTY) continue;
            const next = shapeOf(code + POW3[slot]);
            if (next === LIVE_FOUR) shape = Math.max(shape, LIVE_THREE);
            else if (next === FOUR) shape = Math.max(shape, SLEEP_THREE);
            else if (next === LIVE_THREE) shape = Math.max(shape, LIVE_TWO);
            else if (next === SLEEP_THREE) shape = Math.max(shape, SLEEP_TWO);
          }
        }
      }
      memo[code] = shape;
      return shape;
    };
    const table = new Uint8Array(CODES);
    for (let code = 0; code < CODES; code++) table[code] = shapeOf(code);
    return table;
  }
  var SHAPES = buildShapeTable();
  var SCORE = {
    FIVE: 1e7,
    /** 活四 / 双四：对方无法同时防守，下一手必成五 */
    LIVE_FOUR: 1e6,
    /** 四三：冲四的同时形成活三 */
    FOUR_THREE: 5e5,
    /** 双活三 */
    DOUBLE_THREE: 1e5,
    FOUR: 2e3,
    LIVE_THREE: 1e3,
    SLEEP_THREE: 150,
    LIVE_TWO: 120,
    SLEEP_TWO: 20
  };
  var EVAL_VALUE = [0, 2, 12, 15, 120, 150, 6e3, 1e5];
  var WIN_SCORE = 1e8;
  var ATTACK_WEIGHT = 1.1;
  var LEVELS = {
    easy: { maxDepth: 0, timeMs: 0, rootWidth: 8, width: 8 },
    normal: { maxDepth: 4, timeMs: 500, rootWidth: 10, width: 8 },
    hard: { maxDepth: 8, timeMs: 1500, rootWidth: 16, width: 10 }
  };
  var MAX_PLY = 24;
  var Timeout = class extends Error {
  };
  var now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  var Engine = class {
    constructor(board) {
      this.stones = [];
      this.deadline = Infinity;
      this.nodes = 0;
      this.n = board.size;
      this.cells = new Uint8Array(this.n * this.n);
      this.near = new Uint16Array(this.n * this.n);
      for (const m of board.history) this.place(m.y * this.n + m.x, m.color);
    }
    get stoneCount() {
      return this.stones.length;
    }
    place(i, color) {
      this.cells[i] = color;
      this.stones.push(i);
      this.touch(i, 1);
    }
    remove(i) {
      this.cells[i] = EMPTY;
      this.stones.pop();
      this.touch(i, -1);
    }
    touch(i, delta) {
      const n = this.n;
      const x = i % n;
      const y = (i - x) / n;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(n - 1, y + 2); yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(n - 1, x + 2); xx++) {
          this.near[yy * n + xx] += delta;
        }
      }
    }
    /** 以 (x, y) 为中心、沿 (dx, dy) 方向的 8 格编码（从 color 的视角） */
    lineCode(x, y, dx, dy, color) {
      const n = this.n;
      let code = 0;
      for (let slot = 0; slot < 8; slot++) {
        const k = slot < 4 ? slot - 4 : slot - 3;
        const cx = x + k * dx;
        const cy = y + k * dy;
        let digit = D_BLOCK;
        if (cx >= 0 && cy >= 0 && cx < n && cy < n) {
          const c = this.cells[cy * n + cx];
          digit = c === EMPTY ? D_EMPTY : c === color ? D_OWN : D_BLOCK;
        }
        code += digit * POW3[slot];
      }
      return code;
    }
    /** color 在空点 (x, y) 落子的价值 */
    pointScore(x, y, color) {
      let fours = 0;
      let liveThrees = 0;
      let score = 0;
      for (const [dx, dy] of DIRECTIONS) {
        switch (SHAPES[this.lineCode(x, y, dx, dy, color)]) {
          case FIVE:
            return SCORE.FIVE;
          case LIVE_FOUR:
            fours += 2;
            break;
          case FOUR:
            fours++;
            score += SCORE.FOUR;
            break;
          case LIVE_THREE:
            liveThrees++;
            score += SCORE.LIVE_THREE;
            break;
          case SLEEP_THREE:
            score += SCORE.SLEEP_THREE;
            break;
          case LIVE_TWO:
            score += SCORE.LIVE_TWO;
            break;
          case SLEEP_TWO:
            score += SCORE.SLEEP_TWO;
            break;
        }
      }
      if (fours >= 2) return SCORE.LIVE_FOUR;
      if (fours === 1 && liveThrees > 0) return SCORE.FOUR_THREE;
      if (liveThrees >= 2) return SCORE.DOUBLE_THREE;
      return score;
    }
    candidates(side, defenseWeight = 1) {
      const n = this.n;
      const opp = 3 - side;
      const center = (n - 1) / 2;
      const list = [];
      for (let i = 0; i < n * n; i++) {
        if (this.cells[i] !== EMPTY || this.near[i] === 0) continue;
        const x = i % n;
        const y = (i - x) / n;
        const a = this.pointScore(x, y, side);
        const d = this.pointScore(x, y, opp);
        const centrality = 7 - Math.min(7, Math.max(Math.abs(x - center), Math.abs(y - center)));
        list.push({ i, a, d, s: a * ATTACK_WEIGHT + d * defenseWeight + centrality });
      }
      return list;
    }
    /**
     * 生成候选着法，并识别必须立即处理的局面：
     * - win：己方可直接成五
     * - block：对方下一手可成五，只能去挡
     * - win4：己方可走出活四 / 双四，必胜
     * - normal：按综合分排序后取前 width 个
     */
    generate(side, width) {
      const list = this.candidates(side);
      const blocks = [];
      let myWin = null;
      let oppThreat = false;
      for (const c of list) {
        if (c.a >= SCORE.FIVE) return { kind: "win", moves: [c] };
        if (c.d >= SCORE.FIVE) blocks.push(c);
        if (c.a >= SCORE.LIVE_FOUR && (!myWin || c.a > myWin.a)) myWin = c;
        if (c.d >= SCORE.FOUR_THREE) oppThreat = true;
      }
      if (blocks.length) return { kind: "block", moves: blocks };
      if (myWin) return { kind: "win4", moves: [myWin] };
      const pool = oppThreat ? list.filter((c) => c.d >= SCORE.FOUR_THREE || c.a >= SCORE.FOUR) : list;
      pool.sort((p, q) => q.s - p.s);
      return { kind: "normal", moves: pool.length > width ? pool.slice(0, width) : pool };
    }
    /** 静态评估：从 side 的视角看当前局面 */
    evaluate(side) {
      const n = this.n;
      let total = 0;
      for (const i of this.stones) {
        const color = this.cells[i];
        const x = i % n;
        const y = (i - x) / n;
        let v = 0;
        for (const [dx, dy] of DIRECTIONS) v += EVAL_VALUE[SHAPES[this.lineCode(x, y, dx, dy, color)]];
        total += color === side ? v : -v;
      }
      return total;
    }
    negamax(side, depth, alpha, beta, ply, width) {
      if ((++this.nodes & 255) === 0 && now() > this.deadline) throw new Timeout();
      const { kind, moves } = this.generate(side, width);
      if (moves.length === 0) return 0;
      if (kind === "win") return WIN_SCORE - ply;
      if (kind === "win4") return WIN_SCORE - ply - 2;
      if (kind === "block" && moves.length > 1) return -(WIN_SCORE - ply - 1);
      const forced = kind === "block";
      if (depth <= 0 && !forced || ply >= MAX_PLY) return this.evaluate(side);
      let best = -Infinity;
      for (const m of moves) {
        this.place(m.i, side);
        const v = -this.negamax(3 - side, forced ? depth : depth - 1, -beta, -alpha, ply + 1, width);
        this.remove(m.i);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      return best;
    }
    /** 迭代加深搜索，超时则返回上一轮完整搜索的结果 */
    search(side, root, level) {
      this.deadline = now() + level.timeMs;
      this.nodes = 0;
      let order = root.slice();
      let bestIndex = order[0].i;
      for (let depth = 2; depth <= level.maxDepth; depth += 2) {
        let alpha = -Infinity;
        let bestHere = order[0];
        const scores = /* @__PURE__ */ new Map();
        try {
          for (const m of order) {
            this.place(m.i, side);
            const v = -this.negamax(3 - side, depth - 1, -Infinity, -alpha, 1, level.width);
            this.remove(m.i);
            scores.set(m.i, v);
            if (v > alpha) {
              alpha = v;
              bestHere = m;
            }
          }
        } catch (e) {
          if (e instanceof Timeout) break;
          throw e;
        }
        bestIndex = bestHere.i;
        if (alpha >= WIN_SCORE - MAX_PLY - 2) break;
        order = order.slice().sort((p, q) => {
          var _a, _b;
          return ((_a = scores.get(q.i)) != null ? _a : -Infinity) - ((_b = scores.get(p.i)) != null ? _b : -Infinity);
        });
      }
      return bestIndex;
    }
    /** 简单难度：只看一步，偶尔忽略防守，并带有随机性 */
    pickCasual(side, random) {
      const list = this.candidates(side, random() < 0.3 ? 0.05 : 0.6);
      let best = list[0];
      let bestScore = -Infinity;
      for (const c of list) {
        const s = c.s * (0.75 + random() * 0.5);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best.i;
    }
  };
  function chooseMove(board, color, level = "normal", random = Math.random) {
    const n = board.size;
    const engine = new Engine(board);
    const toPoint = (i) => ({ x: i % n, y: Math.floor(i / n) });
    if (engine.stoneCount === 0) {
      const c = Math.floor(n / 2);
      return { x: c, y: c };
    }
    const settings = LEVELS[level];
    const { kind, moves } = engine.generate(color, settings.rootWidth);
    if (moves.length === 0) throw new Error("\u68CB\u76D8\u5DF2\u6EE1");
    if (kind !== "normal" || moves.length === 1) return toPoint(moves[0].i);
    if (level === "easy") return toPoint(engine.pickCasual(color, random));
    return toPoint(engine.search(color, moves, settings));
  }

  // src/ui/renderer.ts
  var COLUMN_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var DROP_MS = 160;
  var BoardRenderer = class {
    constructor(canvas, size) {
      this.cssSize = 0;
      this.dpr = 1;
      this.cell = 0;
      this.margin = 0;
      this.state = null;
      this.animKey = "";
      this.animStart = 0;
      this.frame = 0;
      this.canvas = canvas;
      this.size = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 Canvas");
      this.ctx = ctx;
    }
    /** 按容器尺寸重新设置画布分辨率 */
    resize(cssSize) {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (cssSize === this.cssSize && dpr === this.dpr) return;
      this.cssSize = cssSize;
      this.dpr = dpr;
      this.canvas.width = Math.round(cssSize * dpr);
      this.canvas.height = Math.round(cssSize * dpr);
      this.cell = cssSize / (this.size - 1 + 2 * 1.05);
      this.margin = this.cell * 1.05;
      if (this.state) this.draw(this.state);
    }
    /** 把鼠标 / 触摸坐标换算为最近的交叉点 */
    pointAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !this.cell) return null;
      const scale = this.cssSize / rect.width;
      const x = Math.round(((clientX - rect.left) * scale - this.margin) / this.cell);
      const y = Math.round(((clientY - rect.top) * scale - this.margin) / this.cell);
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
      return { x, y };
    }
    /** 交叉点的坐标名称，如 H8 */
    static label(p, size) {
      return `${COLUMN_LABELS[p.x]}${size - p.y}`;
    }
    draw(state) {
      this.state = state;
      if (!this.cssSize) return;
      cancelAnimationFrame(this.frame);
      const { ctx, dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssSize, this.cssSize);
      this.drawWood();
      this.drawGrid();
      const { board } = state;
      const last = board.lastMove;
      const lastKey = last ? `${board.moveCount}:${last.x},${last.y}` : "";
      if (lastKey !== this.animKey) {
        this.animKey = lastKey;
        this.animStart = performance.now();
      }
      const progress = Math.min(1, (performance.now() - this.animStart) / DROP_MS);
      board.history.forEach((m, index) => {
        const isLast = index === board.moveCount - 1;
        const scale = isLast ? 0.82 + 0.18 * easeOutBack(progress) : 1;
        this.drawStone(m.x, m.y, m.color, { scale });
      });
      if (state.status.kind === "win") this.drawWinLine(state.status.line);
      if (state.showNumbers) {
        board.history.forEach((m, index) => this.drawNumber(m.x, m.y, m.color, index + 1, index === board.moveCount - 1));
      } else if (last) {
        this.drawLastMarker(last.x, last.y);
      }
      const { cursor } = state;
      if (cursor && board.isEmpty(cursor.x, cursor.y) && state.previewColor) {
        this.drawStone(cursor.x, cursor.y, state.previewColor, { alpha: 0.42, shadow: false });
      }
      if (cursor && state.showCursor) this.drawCursor(cursor);
      if (progress < 1) this.frame = requestAnimationFrame(() => this.state && this.draw(this.state));
    }
    /* ------------------------------------------------------------------------ */
    pos(i) {
      return this.margin + i * this.cell;
    }
    /** 让细线对齐到物理像素，避免模糊 */
    snap(v, lineWidthPx) {
      const offset = lineWidthPx % 2 === 1 ? 0.5 : 0;
      return (Math.round(v * this.dpr - offset) + offset) / this.dpr;
    }
    drawWood() {
      const { ctx, cssSize: s } = this;
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, "#ecc98f");
      g.addColorStop(0.5, "#e2b778");
      g.addColorStop(1, "#d7a864");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = "#7a4b1c";
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const y0 = s / 26 * i + i * 37 % 11;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= s; x += s / 12) {
          ctx.lineTo(x, y0 + Math.sin(x / s * 6 + i) * s * 8e-3);
        }
        ctx.stroke();
      }
      ctx.restore();
      const v = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.75);
      v.addColorStop(0, "rgba(255, 240, 210, 0.18)");
      v.addColorStop(1, "rgba(90, 50, 10, 0.12)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, s, s);
    }
    drawGrid() {
      const { ctx, size, cell } = this;
      const thin = Math.max(1, Math.round(this.dpr));
      const start = this.pos(0);
      const end = this.pos(size - 1);
      ctx.strokeStyle = "rgba(58, 36, 14, 0.82)";
      ctx.lineWidth = thin / this.dpr;
      ctx.beginPath();
      for (let i = 1; i < size - 1; i++) {
        const p = this.snap(this.pos(i), thin);
        ctx.moveTo(start, p);
        ctx.lineTo(end, p);
        ctx.moveTo(p, start);
        ctx.lineTo(p, end);
      }
      ctx.stroke();
      const thick = thin * 2;
      ctx.lineWidth = thick / this.dpr;
      const a = this.snap(start, thick);
      const b = this.snap(end, thick);
      ctx.strokeRect(a, a, b - a, b - a);
      ctx.fillStyle = "rgba(58, 36, 14, 0.9)";
      for (const [x, y] of starPoints(size)) {
        ctx.beginPath();
        ctx.arc(this.pos(x), this.pos(y), Math.max(2.5, cell * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(70, 44, 18, 0.75)";
      ctx.font = `600 ${Math.max(9, Math.round(cell * 0.32))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const edge = this.margin * 0.48;
      for (let i = 0; i < size; i++) {
        const p = this.pos(i);
        const col = COLUMN_LABELS[i];
        const row = String(size - i);
        ctx.fillText(col, p, edge);
        ctx.fillText(col, p, this.cssSize - edge);
        ctx.fillText(row, edge, p);
        ctx.fillText(row, this.cssSize - edge, p);
      }
    }
    drawStone(x, y, color, opts = {}) {
      const { ctx } = this;
      const { scale = 1, alpha = 1, shadow = true } = opts;
      const cx = this.pos(x);
      const cy = this.pos(y);
      const r = this.cell * 0.46 * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (shadow) {
        ctx.shadowColor = "rgba(40, 20, 0, 0.45)";
        ctx.shadowBlur = this.cell * 0.14;
        ctx.shadowOffsetX = this.cell * 0.04;
        ctx.shadowOffsetY = this.cell * 0.07;
      }
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
      if (color === BLACK) {
        g.addColorStop(0, "#77736e");
        g.addColorStop(0.35, "#2b2a28");
        g.addColorStop(1, "#0a0a0a");
      } else {
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.6, "#f1efea");
        g.addColorStop(1, "#c7c2b8");
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawLastMarker(x, y) {
      const { ctx } = this;
      ctx.fillStyle = "#e5482f";
      ctx.beginPath();
      ctx.arc(this.pos(x), this.pos(y), this.cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    drawNumber(x, y, color, n, isLast) {
      const { ctx, cell } = this;
      const digits = String(n).length;
      const fontSize = cell * (digits >= 3 ? 0.3 : 0.38);
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isLast ? "#e5482f" : color === BLACK ? "#f4f1ea" : "#1d1b18";
      ctx.fillText(String(n), this.pos(x), this.pos(y) + fontSize * 0.04);
    }
    drawWinLine(line) {
      const { ctx, cell } = this;
      const first = line[0];
      const last = line[line.length - 1];
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(229, 72, 47, 0.85)";
      ctx.lineWidth = cell * 0.12;
      ctx.beginPath();
      ctx.moveTo(this.pos(first.x), this.pos(first.y));
      ctx.lineTo(this.pos(last.x), this.pos(last.y));
      ctx.stroke();
      ctx.lineWidth = Math.max(2, cell * 0.07);
      for (const p of line) {
        ctx.beginPath();
        ctx.arc(this.pos(p.x), this.pos(p.y), cell * 0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawCursor(p) {
      const { ctx, cell } = this;
      const cx = this.pos(p.x);
      const cy = this.pos(p.y);
      const h = cell * 0.5;
      const arm = cell * 0.18;
      ctx.save();
      ctx.strokeStyle = "#1f6feb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = cx + sx * h;
        const y = cy + sy * h;
        ctx.moveTo(x - sx * arm, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * arm);
      }
      ctx.stroke();
      ctx.restore();
    }
  };
  function starPoints(size) {
    const c = Math.floor(size / 2);
    if (size < 9) return [[c, c]];
    const d = size >= 13 ? 3 : 2;
    const far = size - 1 - d;
    return [[d, d], [far, d], [d, far], [far, far], [c, c]];
  }
  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // src/main.ts
  var STORAGE_KEY = "five-in-a-row:v2";
  var DEFAULT_SETTINGS = { mode: "pve", side: "black", level: "normal", showNumbers: false };
  var AI_MIN_DELAY_MS = 380;
  var LEVEL_NAMES = { easy: "\u7B80\u5355", normal: "\u666E\u901A", hard: "\u56F0\u96BE" };
  var $ = (selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`\u627E\u4E0D\u5230\u5143\u7D20 ${selector}`);
    return el;
  };
  function loadSave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function writeSave(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    }
  }
  function sanitizeSettings(s) {
    const v = { ...DEFAULT_SETTINGS, ...s };
    return {
      mode: v.mode === "pvp" ? "pvp" : "pve",
      side: v.side === "white" ? "white" : "black",
      level: v.level === "easy" || v.level === "hard" ? v.level : "normal",
      showNumbers: v.showNumbers === true
    };
  }
  var App = class {
    constructor() {
      this.game = new Game();
      this.cursor = null;
      this.keyboardCursor = false;
      this.thinking = false;
      /** 每次取消 / 重新安排 AI 时自增，用于丢弃过期的 AI 结果 */
      this.aiToken = 0;
      this.resultDismissed = false;
      this.canvas = $("#board");
      this.statusStone = $("#status-stone");
      this.statusText = $("#status-text");
      this.statusSub = $("#status-sub");
      this.undoBtn = $("#undo");
      this.restartBtn = $("#restart");
      this.numbersToggle = $("#show-numbers");
      this.result = $("#result");
      this.resultTitle = $("#result-title");
      this.resultSub = $("#result-sub");
      this.announcer = $("#announcer");
      this.renderer = new BoardRenderer(this.canvas, this.game.board.size);
      const save = loadSave();
      this.settings = sanitizeSettings(save.settings);
      if (Array.isArray(save.moves)) {
        this.game.replay(save.moves.filter((m) => Array.isArray(m)).map(([x, y]) => ({ x, y })));
        this.resultDismissed = this.game.isOver;
      }
      this.bindControls();
      this.bindBoard();
      this.observeSize();
      this.syncControls();
      this.update();
      this.scheduleAi();
    }
    /* ---------------------------------- 角色 ---------------------------------- */
    get humanColor() {
      return this.settings.side === "black" ? BLACK : WHITE;
    }
    get aiColor() {
      return this.settings.mode === "pve" ? opponent(this.humanColor) : null;
    }
    get isHumanTurn() {
      return !this.game.isOver && !this.thinking && this.game.turn !== this.aiColor;
    }
    /* ---------------------------------- 操作 ---------------------------------- */
    play(p) {
      const move = this.game.play(p.x, p.y);
      if (!move) return;
      if (this.game.isOver) this.resultDismissed = false;
      this.announce(`${colorName(move.color)}\u843D\u5B50 ${BoardRenderer.label(move, this.game.board.size)}`);
      this.update();
      this.scheduleAi();
    }
    humanPlay(p) {
      if (this.isHumanTurn && this.game.canPlay(p.x, p.y)) this.play(p);
    }
    undo() {
      if (!this.canUndo()) return;
      this.cancelAi();
      if (this.settings.mode === "pvp") {
        this.game.undo();
      } else {
        let move;
        do
          move = this.game.undo();
        while (move && move.color !== this.humanColor);
      }
      this.announce("\u5DF2\u6094\u68CB");
      this.update();
      this.scheduleAi();
    }
    canUndo() {
      const history = this.game.board.history;
      if (this.settings.mode === "pvp") return history.length > 0;
      return history.some((m) => m.color === this.humanColor);
    }
    restart() {
      this.cancelAi();
      this.game.reset();
      this.resultDismissed = false;
      this.announce("\u65B0\u7684\u4E00\u5C40\u5F00\u59CB\u4E86");
      this.update();
      this.scheduleAi();
    }
    /* ----------------------------------- AI ----------------------------------- */
    scheduleAi() {
      if (this.aiColor === null || this.game.isOver || this.game.turn !== this.aiColor || this.thinking) return;
      const token = ++this.aiToken;
      const color = this.aiColor;
      const level = this.settings.level;
      this.thinking = true;
      this.update();
      const started = performance.now();
      requestAnimationFrame(
        () => setTimeout(() => {
          if (token !== this.aiToken) return;
          const move = chooseMove(this.game.board, color, level);
          const wait = Math.max(0, AI_MIN_DELAY_MS - (performance.now() - started));
          setTimeout(() => {
            if (token !== this.aiToken) return;
            this.thinking = false;
            this.play(move);
          }, wait);
        }, 0)
      );
    }
    cancelAi() {
      this.aiToken++;
      this.thinking = false;
    }
    /* --------------------------------- 设置 ---------------------------------- */
    changeSetting(key, value) {
      if (this.settings[key] === value) return;
      const restartNeeded = key === "mode" || key === "side";
      const inProgress = !this.game.isOver && this.game.board.moveCount > 1;
      if (restartNeeded && inProgress && !window.confirm("\u5207\u6362\u540E\u5C06\u91CD\u65B0\u5F00\u59CB\u672C\u5C40\uFF0C\u786E\u5B9A\u5417\uFF1F")) {
        this.syncControls();
        return;
      }
      this.settings = { ...this.settings, [key]: value };
      this.syncControls();
      if (restartNeeded) this.restart();
      else this.update();
    }
    /* --------------------------------- 界面 ---------------------------------- */
    bindControls() {
      document.querySelectorAll("[data-setting]").forEach((group) => {
        const key = group.dataset.setting;
        group.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-value]");
          if (btn) this.changeSetting(key, btn.dataset.value);
        });
      });
      this.numbersToggle.addEventListener("change", () => this.changeSetting("showNumbers", this.numbersToggle.checked));
      this.undoBtn.addEventListener("click", () => this.undo());
      this.restartBtn.addEventListener("click", () => this.restart());
      $("#result-again").addEventListener("click", () => this.restart());
      $("#result-close").addEventListener("click", () => {
        this.resultDismissed = true;
        this.update();
      });
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
          e.preventDefault();
          this.undo();
        } else if (e.key === "Escape" && this.game.isOver && !this.resultDismissed) {
          this.resultDismissed = true;
          this.update();
        }
      });
    }
    bindBoard() {
      const { canvas } = this;
      canvas.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return;
        this.keyboardCursor = false;
        this.setCursor(this.renderer.pointAt(e.clientX, e.clientY));
      });
      canvas.addEventListener("pointerleave", () => {
        if (!this.keyboardCursor) this.setCursor(null);
      });
      canvas.addEventListener("click", (e) => {
        const p = this.renderer.pointAt(e.clientX, e.clientY);
        if (p) this.humanPlay(p);
      });
      canvas.addEventListener("keydown", (e) => {
        const size = this.game.board.size;
        const deltas = {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0]
        };
        const clamp = (v) => Math.min(size - 1, Math.max(0, v));
        if (e.key in deltas) {
          e.preventDefault();
          this.keyboardCursor = true;
          if (this.cursor) {
            const [dx, dy] = deltas[e.key];
            this.cursor = { x: clamp(this.cursor.x + dx), y: clamp(this.cursor.y + dy) };
          } else {
            const c = Math.floor(size / 2);
            const last = this.game.board.lastMove;
            this.cursor = last ? { x: last.x, y: last.y } : { x: c, y: c };
          }
          this.draw();
        } else if ((e.key === "Enter" || e.key === " ") && this.cursor) {
          e.preventDefault();
          this.humanPlay(this.cursor);
        }
      });
      canvas.addEventListener("blur", () => {
        if (this.keyboardCursor) {
          this.keyboardCursor = false;
          this.setCursor(null);
        }
      });
    }
    observeSize() {
      const resize = () => this.renderer.resize(this.canvas.clientWidth);
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(this.canvas);
      else window.addEventListener("resize", resize);
      window.addEventListener("resize", resize);
      resize();
    }
    setCursor(p) {
      const same = p === this.cursor || p && this.cursor && p.x === this.cursor.x && p.y === this.cursor.y;
      if (same) return;
      this.cursor = p;
      this.draw();
    }
    syncControls() {
      document.querySelectorAll("[data-setting]").forEach((group) => {
        const key = group.dataset.setting;
        group.querySelectorAll("button[data-value]").forEach((btn) => {
          const active = btn.dataset.value === this.settings[key];
          btn.classList.toggle("active", active);
          btn.setAttribute("aria-pressed", String(active));
        });
      });
      document.body.classList.toggle("mode-pvp", this.settings.mode === "pvp");
      this.numbersToggle.checked = this.settings.showNumbers;
    }
    draw() {
      const preview = this.isHumanTurn ? this.game.turn : null;
      this.renderer.draw({
        board: this.game.board,
        status: this.game.status,
        cursor: this.cursor,
        previewColor: preview,
        showCursor: this.keyboardCursor,
        showNumbers: this.settings.showNumbers
      });
      this.canvas.style.cursor = preview && this.cursor && this.game.board.isEmpty(this.cursor.x, this.cursor.y) ? "pointer" : "default";
    }
    /** 状态变化后统一刷新界面并保存 */
    update() {
      const { game, settings } = this;
      const status = game.status;
      const pve = settings.mode === "pve";
      const moves = game.board.moveCount;
      let stone = game.turn;
      let text;
      let sub;
      if (status.kind === "win") {
        stone = status.winner;
        text = pve ? status.winner === this.humanColor ? "\u4F60\u8D62\u4E86\uFF01" : "\u7535\u8111\u83B7\u80DC" : `${colorName(status.winner)}\u83B7\u80DC\uFF01`;
        sub = `\u5171 ${moves} \u624B`;
      } else if (status.kind === "draw") {
        text = "\u5E73\u5C40";
        sub = "\u68CB\u76D8\u5DF2\u4E0B\u6EE1";
      } else if (this.thinking) {
        text = "\u7535\u8111\u601D\u8003\u4E2D\u2026";
        sub = `\u7B2C ${moves + 1} \u624B \xB7 ${LEVEL_NAMES[settings.level]}`;
      } else if (pve) {
        text = "\u8F6E\u5230\u4F60\u4E86";
        sub = `\u4F60\u6267${this.humanColor === BLACK ? "\u9ED1" : "\u767D"} \xB7 \u7B2C ${moves + 1} \u624B`;
      } else {
        text = `${colorName(game.turn)}\u843D\u5B50`;
        sub = `\u7B2C ${moves + 1} \u624B`;
      }
      this.statusText.textContent = text;
      this.statusSub.textContent = sub;
      this.statusStone.className = `stone ${stone === BLACK ? "black" : "white"}`;
      this.statusStone.classList.toggle("pulse", this.thinking);
      document.body.classList.toggle("thinking", this.thinking);
      this.undoBtn.disabled = !this.canUndo();
      this.restartBtn.disabled = moves === 0 && !this.thinking;
      const showResult = game.isOver && !this.resultDismissed;
      this.result.hidden = !showResult;
      if (showResult) {
        this.resultTitle.textContent = text;
        this.resultSub.textContent = status.kind === "win" ? `${colorName(status.winner)}\u4E94\u5B50\u8FDE\u73E0 \xB7 \u5171 ${moves} \u624B` : "\u53CC\u65B9\u90FD\u6CA1\u80FD\u8FDE\u6210\u4E94\u5B50";
        this.result.dataset.tone = status.kind === "win" && pve && status.winner !== this.humanColor ? "lose" : "win";
        let place = "center";
        if (status.kind === "win") {
          const avgY = status.line.reduce((sum, p) => sum + p.y, 0) / status.line.length;
          place = avgY < (game.board.size - 1) / 2 ? "bottom" : "top";
        }
        this.result.dataset.place = place;
      }
      if (game.isOver) this.announce(text);
      this.draw();
      writeSave({ settings, moves: game.board.history.map((m) => [m.x, m.y]) });
    }
    announce(message) {
      this.announcer.textContent = message;
    }
  };
  new App();
})();
