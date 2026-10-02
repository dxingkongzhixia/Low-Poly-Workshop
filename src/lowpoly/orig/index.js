/**
 * lowpoly/orig/index.js —— 原作角色的**程序化移植**层。
 * 每个角色一份 `*_DATA`（自动生成）+ 统一的 buildFromPort()。
 * 移植规程见 docs/lowpoly-runtime.md §8.5。
 */
import { TEXAS_DATA } from './texas.js';
import { AAK_DATA }   from './aak.js';
import { SORA_DATA }  from './sora.js';
import { SWIRE_DATA } from './swire.js';
import { CHEN_DATA }      from './chen.js';
import { CROISSANT_DATA } from './croissant.js';
import { HOSHIGUMA_DATA } from './hoshiguma.js';
import { EMPEROR_DATA }   from './emperor.js';
import { LEE_DATA }       from './lee.js';
import { LAPPLAND_DATA }  from './lappland.js';
import { HUNG_DATA }      from './hung.js';
import { WAAIFU_DATA }    from './waaifu.js';
import { EXUSIAI_DATA }   from './exusiai.js';
import { MOSTIMA_DATA }   from './mostima.js';
import { buildFromPort } from './port.js';

/** 已移植的原作角色：id → 捕获数据（14 / 14） */
export const PORTS = {
  texas: TEXAS_DATA, aak: AAK_DATA, sora: SORA_DATA, swire: SWIRE_DATA,
  chen: CHEN_DATA, croissant: CROISSANT_DATA, hoshiguma: HOSHIGUMA_DATA,
  emperor: EMPEROR_DATA, lee: LEE_DATA, lappland: LAPPLAND_DATA,
  hung: HUNG_DATA, waaifu: WAAIFU_DATA, exusiai: EXUSIAI_DATA, mostima: MOSTIMA_DATA,
};

export { TEXAS_DATA, AAK_DATA, SORA_DATA, SWIRE_DATA, CHEN_DATA, CROISSANT_DATA,
  HOSHIGUMA_DATA, EMPEROR_DATA, LEE_DATA, LAPPLAND_DATA, HUNG_DATA, WAAIFU_DATA,
  EXUSIAI_DATA, MOSTIMA_DATA, buildFromPort };
