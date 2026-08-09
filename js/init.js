/**================================================================================
@file 五子棋初始化文件
================================================================================*/
/**
 * @classdesc 初始化棋盘
 */
var Init = /** @class */ (function () {
    function Init() {
        /** 获取棋盘中的 canvas 元素 */
        this._canvas = document.getElementsByClassName('checkerboard')[0].getElementsByTagName('canvas')[0];
        /** canvas 上下文 */
        this._ctx = this._canvas.getContext('2d');
        /** x 坐标 */
        this._x = 0;
        /** y 坐标 */
        this._y = 0;
        // 设置 canvas 元素的宽高
        this._canvas.width = 960;
        this._canvas.height = 960;
        // 循环添加 显示的格子 第一层循环为 行
        for (var i = 0; i < 16; i++) {
            // 在 循环开始时 重置 x 坐标
            this._x = 0;
            // 第二层循环为 列
            for (var j = 0; j < 16; j++) {
                // 打开路径
                this._ctx.beginPath();
                // 绘制描边矩
                this._ctx.strokeRect(this._x, this._y, 60, 60);
                // 关闭路径
                this._ctx.closePath();
                // 绘制 星位
                if (j === 4 && i === 4 ||
                    j === 12 && i === 4 ||
                    j === 4 && i === 12 ||
                    j === 12 && i === 12 ||
                    j === 8 && i === 8) {
                    // 打开路径
                    this._ctx.beginPath();
                    // 绘制 圆
                    this._ctx.arc(this._x, this._y, 8, 0, 360, false);
                    // 填充
                    this._ctx.fill();
                    // 关闭路径
                    this._ctx.closePath();
                }
                // 当前 x 坐标 加 60
                this._x += 60;
            }
            // 当前 y 坐标 加 60
            this._y += 60;
        }
    }
    return Init;
}());
