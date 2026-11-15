/**
 * 把测试进程的时区钉死成园区时区（东八区）。
 *
 * 为什么需要这一层：
 * `bun test lib` 一次跑 80 个文件时，worker 里 `Date` 的本地时区会退化成 UTC
 * （`new Date().getTimezoneOffset()` 返回 0），而 `serverTzOffsetMin()` 在模块
 * 初始化那一刻已经按 /etc/localtime 取到了 +480。两边口径不一致，凡是拿
 * `new Date(y, m, d, ...)` 当基准的「本地日期」断言就会整体差 8 小时，
 * 部署门禁（`pnpm run test`）直接红，代码根本上不了线。
 *
 * 单跑某个文件不会复现，`TZ=Asia/Shanghai bun test` 也能绕过；但环境变量那种
 * 写法在 Windows 上不成立，所以统一放在 bunfig 的 preload 里，各平台一致。
 *
 * 只影响测试进程，不会进生产包，也不改变运行时行为。
 */
process.env.TZ = 'Asia/Shanghai';
