/**
 * characters.lowpoly.js —— 「程序化角色运行时」入口（Barrel）。
 *
 * 实现在 src/lowpoly/：
 *   人物模型   lowpoly/model.js
 *   武器池绑定 lowpoly/weapons.js（本体）· lowpoly/moves.js（动作）· lowpoly/rig.js（池 / 绑定）
 *   动作绑定   lowpoly/actions.js（移动 / 活动）
 *   抽象角色   lowpoly/character.js
 *   导出       lowpoly/export.js
 *
 * 老的 `import * as LP from '../src/characters.lowpoly.js'` 一步不用改。
 */
export * from './lowpoly/index.js';
