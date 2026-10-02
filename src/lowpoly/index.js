/**
 * lowpoly/index.js —— 「程序化角色运行时」的统一出口（Barrel）。
 * 三个大块 + 导出：
 *   人物模型   model.js
 *   武器池绑定 weapons.js（武器本体）· moves.js（武器动作）· rig.js（池 / 绑定）
 *   动作绑定   actions.js（移动 / 活动）
 *   抽象角色   character.js
 */
export * from './model.js';
export * from './weapons.js';
export * from './moves.js';
export * from './actions.js';
export * from './rig.js';
export * from './character.js';
export * from './export.js';
export * from './orig/index.js';
