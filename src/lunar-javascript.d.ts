/**
 * lunar-javascript 没有自带 TS 类型，这里只做最小声明：
 * 把整个模块当成 `any`，领域层只在 `domain/lunar.ts` 一个文件里碰它，
 * 不把 `any` 漏到别处。
 */
declare module 'lunar-javascript';
