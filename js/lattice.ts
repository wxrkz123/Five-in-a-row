/**================================================================================
@file 五子棋添加格子文件
@description 添加的并非显示的格子，而是隐藏的真正存放棋子的格子
================================================================================*/


/**
 * @classdesc 添加格子
 */

class Lattice {

	/** 行号 */
	_row: number = 1

	/** 列号 */
	_column: number = 1

	/** 序号 */
	_order: number = 1

	/** 格子的父元素 */
	_parent: Element = document.getElementsByClassName('checkerContent')[0]

	/** 是哪一色的棋子，true 为 黑， false 为 白 */
	_color: boolean = true

	/** 棋子的顺序 用于撤销 */
	_orderList: Array<number[]> = []

	/** 暂时的 棋子的 顺序 */
	_tempList: number[] = []

	/** 是否已胜利 */
	_winner:boolean = false

	constructor() {
		for (this._row; this._row <= 17; this._row++) {
			this._column = 1
			for (this._column; this._column <= 17; this._column++) {

				/** @constant 用于创建格子元素 */
				const lattice = document.createElement('div')

				// 添加属性
				lattice.setAttribute('class', `lattice order-${this._order++} row-${this._row} column-${this._column}`)

				// 绑定事件
				lattice.onclick = e => {
					// 如果 没有 子元素
					if (!lattice.childNodes.length) this.chess(lattice)
				}

				// 添加格子
				this._parent.appendChild(lattice)
			}
		}
	}

	/**
	 * 用于添加棋子
	 * @param {Element} lattice 是 添加棋子的 格子
	 */
	chess(lattice: Element) {

		/** @constant 用于创建 棋子 */
		const chess = document.createElement('div')


		// 是 黑色
		if (this._color) chess.className = 'black chess'
		else chess.className = 'white chess'
		// 变换颜色
		this._color = !this._color
		lattice.appendChild(chess)
		this.rule(chess)
	}

	/**
	 * 规则函数
	 * 用于判断五子棋是否连成五子
	 * @param {Element} chess 
	 * 当前所下的棋子 以其为中心 进行判断
	 */
	rule(chess: Element) {

		/** 
		 * @constant
		 * 用于获取棋子的父元素类名的数组
		 * 
		 * lattice order-XX row-X column-XX
		 * ["lattice", "order-60", "row-4", "column-12"]
		 */
		const parent = chess.parentElement.className.split(' ')

		/** @constant 用于获取棋子的 x 坐标 */
		const x: number = Number(String(parent[3]).split('-')[1])

		/** @constant 用于获取棋子的 y 坐标 */
		const y: number = Number(String(parent[2]).split('-')[1])

		/** @constant 用于获取棋子的序号 */
		const order: number = Number(String(parent[1]).split('-')[1])

		this._tempList.push(order)
		/**
		 * 有 上 下 左 右 
		 * 左上 坐下 右上 右下 
		 * 共 八个 方位需要判断
		 */
		const position = [['+', '+'], ['+', '-'], ['-', '-'], ['-', '+'], [' ', '+'], [' ', '-'], ['-', ' '], ['+', ' ']]

		for (let i = 0; i < position.length; i++) {

			/** @constant 获取运算方位的方式 */
			const first: string = position[i][0]

			/** @constant 获取运算方位的方式 */
			const last: string = position[i][1]

			/** @constant 用于 存放在 循环中获取 棋子的 颜色 */
			const color: string[] = []

			/** @constant 获取棋子颜色 */
			const chessColorClass = chess.className.split(' ')[0]

			// 五子棋 因为包含
			// 当前正在进行判断的位置
			// 所以 只需要 循环 4 次
			for (let j = 1; j < 5; j++) {

				// 获取 坐标
				const row: number = this.calculate(first, y, j)
				const column: number = this.calculate(last, x, j)

				// 如果 有一个 为 null 停止 循环
				if (row === null || column === null) break

				/** @constant 运算完成的格子坐标 */
				const className: string = `lattice row-${row} column-${column}`

				/** @constant 获取的格子 */
				const lattice = document.getElementsByClassName(className)[0]

				// 如果 获取的格子有子元素
				if (lattice.childNodes.length) {
					// 如果 棋子的类名 等于 获取的棋子的类名
					if (lattice.children[0].className.split(' ')[0] === chessColorClass) color.push(chessColorClass)
				}
				// 没有子元素 停止当前循环
				else continue
			}

			// 如果 color 的 长度 等于 4
			if (color.length === 4) {
				// 进行判断 以免出错
				for (let i = 0; i < color.length; i++) {
					if (color[i] !== chessColorClass) break
				}
				// 如果 本局尚未有人胜利
				if(!this._winner) this.winner()
			}
		}
		// 如果 颜色 变更为 了 黑色 即 新一回合
		if (this._color) {
			this._orderList.push(this._tempList)
			this._tempList = []
		}
	}

	/**
	 * 
	 * @param method 运算方法
	 * @param goal 获取的坐标
	 * @param frequency 循环的次数
	 * @returns position 运算完成的坐标
	 */
	calculate(method: string, goal: number, frequency: number): number {

		let position: number
		// 如果 方法 不为空
		if (method !== ' ') {
			// 如果 方法 等于 加 坐标等于 获取的坐标 减去 循环次数
			if (method === '+') position = goal + frequency
			// 否则 为 减
			else position = goal - frequency
			// 如果 为空 则 不变
		} else position = goal

		// 进行判断 如果 大于或小于 边界线
		if (position > 17) return null
		if (position < 1) return null

		// 返回
		return position
	}

	/**
	 * 用于提示 胜利
	 */
	winner() {

		/** @constant 创建弹窗元素 */
		const popUps = document.createElement('div')

		// 设置属性
		popUps.setAttribute('class', 'winner')

		// 设置 文本
		popUps.innerHTML = (this._color ? '白方' : '黑方') + '获胜!'

		document.getElementsByTagName('body')[0].appendChild(popUps)

		this._winner = true

		setTimeout(() => {
			document.getElementsByTagName('body')[0].removeChild(document.getElementsByClassName('winner')[0])
		}, 4000);
		
	}
}