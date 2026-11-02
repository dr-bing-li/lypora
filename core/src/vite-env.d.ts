/// <reference types="vite/client" />

/**
 * 由 vite.config.ts 的 `define` 从 package.json 注入。
 * 版本号只有一个真源，界面上的「关于」不再手写 0.4.x。
 */
declare const __APP_VERSION__: string
