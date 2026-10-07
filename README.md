# 五子棋 Five-in-a-row

用 **TypeScript + Canvas + SCSS** 编写的网页版双人五子棋，无任何依赖，打开即玩。

## 特性

- Canvas 绘制 16×16 棋盘与 5 个星位
- 17×17 个隐藏格点承载棋子，点击落子，黑白交替
- 以落子为中心检测 8 个方向，自动判断五子连珠

## 运行

```bash
git clone https://github.com/wxrkz123/Five-in-a-row.git
```

直接用浏览器打开 `index.html` 即可。

## 开发

`js/` 下的 `.js` 是由 `.ts` 编译而来，`css/index.css` 由 `index.scss` 编译而来。修改源码后重新编译：

```bash
npm i -g typescript sass
tsc js/init.ts js/lattice.ts --target ES2015
sass css/index.scss css/index.css
```

## 目录结构

```
├── index.html
├── css/
│   ├── index.scss      样式源码
│   └── index.css
└── js/
    ├── init.ts / .js     初始化棋盘（Canvas 绘制网格与星位）
    └── lattice.ts / .js  落子与胜负判断
```
