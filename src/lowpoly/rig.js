/**
 * lowpoly/rig.js —— **武器池绑定**层：mountWeapons()。
 * 两个池（角色武器池 / 共享池）互斥、2 手位、角色绑定、动作序列，全在这里。
 */
import * as THREE from 'three';
import { Builder, DARK } from './model.js';
import { WEAPONS, HAND, extractNativeWeapons } from './weapons.js';
import { ATTACKS, COMBOS } from './moves.js';

/** 背袋：收纳型武器（gate:'stowed'，如莫斯提马的法杖）收械时挂在这里，而不是凭空消失 */
function makeWeaponBag(body) {
  const bag = new THREE.Group();
  bag.name = 'weapon-bag';
  bag.position.set(0, .79, -.52);
  bag.rotation.z = -1.05;
  body.add(bag);
  new Builder().box(0, 0, 0, .27, 1.02, .12, 3355194).box(0, 0, -.07, .2, .84, .018, 5854554)
    .box(0, -.4, -.087, .28, .055, .025, DARK).box(0, .4, -.087, .28, .055, .025, DARK)
    .build(bag);
  return bag;
}

export function mountWeapons(model, loadout, opts = {}) {
  const entries = [];
  /* ★ 项目2：武器是**模型自带的独立网格**（按名字分割），不是另建几何 */
  const nativeList = extractNativeWeapons(model);
  /** 造一把武器的 group（先不挂）—— entries（共享池）和**绑定**的处生武器都用它 */
  function buildWeaponGroup(def, spec) {
    const side = spec.side ?? (spec.arm === 0 ? -1 : 1);
    const group = new THREE.Group(); group.name = spec.id;
    const inner = new THREE.Group();
    const grip = def.grip ?? HAND;
    inner.position.set(-grip[0], -grip[1], -grip[2]);
    group.add(inner);
    const b = new Builder();
    def.build(b, side);                       // 原作注册表的 build() 不 return b —— 别链式调用
    const mesh = b.build(inner);
    if (mesh && def.metalness != null) mesh.material.metalness = def.metalness;
    return { group, inner, side };
  }
  /** 把武器 group 摆到手上（握把 / 朝向 / 缩放）—— entries 和绑定原生武器共用 */
  function holdTransform(group, arm, hold, spec) {
    hold = hold ?? {};
    const rot = [...(hold.rot ?? [0, 0, 0])];
    if (hold.mirrorZ) rot[2] *= ((spec.arm ?? 0) === 0 ? 1 : -1);
    group.position.set(...(hold.pos ?? HAND));
    group.quaternion.copy(arm.quaternion.clone().invert())
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)));
    group.scale.setScalar(hold.scale ?? 1);
  }
  function attach(spec) {
    const def = WEAPONS[spec.id];
    if (!def) return null;
    if (def.slots === 2 && spec.arm == null) {          // 成对武器（如双剑）：默认占双手
      attach({ ...spec, arm: 0, side: -1 });
      attach({ ...spec, arm: 1, side: 1 });
      return null;
    }
    const { group, inner, side } = buildWeaponGroup(def, spec);
    model.body.add(group);
    const entry = { def, spec: { ...spec, side }, side, group, inner,
                    moves: (def.attacks ?? [spec.id]).map((k) => ATTACKS[k]).filter(Boolean) };
    entries.push(entry);
    return entry;
  }
  /* ★ **角色绑定的武器**（如黑岩的黑刃 / 黑岩巨炮）：不进共享池，而是进「角色武器池」（nativeList）——
     和小人身上烘出来的原生武器走同一套（开关 / 手位计数 / 动作）。`opts.bind` = [{id, arm}] */
  for (const spec of (opts.bind || [])) {
    const def = WEAPONS[spec.id]; if (!def) continue;
    const { group } = buildWeaponGroup(def, spec);
    (model.arms[spec.arm ?? 0] || model.body).add(group);
    nativeList.push({ name: spec.id, label: def.label, object: group,
                      type: (def.attacks ?? [])[0] ?? def.type ?? null, hands: def.hands || 1,
                      moves: (def.attacks ?? [spec.id]).map((k) => ATTACKS[k]).filter(Boolean),
                      def, spec: { ...spec } });
  }
  const native = nativeList.map((n) => n.object);
  const rig = {
    entries, armed: false, activity: '', move: 0, nativeObjects: native, nativeList,
    nativeOn: new Set(native),                    // 哪些**原生武器**开着（默认全开）
    poolMode: 'native',                           // 'native' = 角色武器池 | 'shared' = 共享池（黑刃/巨炮）—— **互斥**
    /** 一把原生武器挂在哪只手上（沿父链找 arm bone） */
    armIndexOf(o) { let g = o, idx = -1; while (g) { const i = model.arms.indexOf(g); if (i >= 0) { idx = i; break; } g = g.parent; } return idx >= 0 ? idx : 0; },
    ourArms() { return new Set(entries.filter((e) => e.def.slot === 'hand').map((e) => e.spec.arm ?? 0)); },
    /** 当前占了几个手位（**上限 2**）：分池各算各的 —— 两池互斥，不会相加 */
    activeCount() {
      if (rig.poolMode === 'shared') return rig.ourArms().size;
      const ours = rig.ourArms(); let n = ours.size;
      for (const x of nativeList) if (rig.nativeOn.has(x.object) && !ours.has(rig.armIndexOf(x.object))) n++;
      return n;
    },
    /** ★ 切池：用角色武器池就藏共享武器；用共享池就藏原生武器 */
    setPool(mode) {
      rig.poolMode = mode;
      if (mode === 'native') { for (const a of [0, 1]) rig.clearArm(a); if (!rig.nativeOn.size) rig.nativeOn = new Set(native.slice(0, 2)); }
      else rig.nativeOn = new Set();
      rig.setArmed(rig.armed, rig.activity);
    },
    /** 开 / 关一把原生武器（自动切到角色池）；**超 2 个手位**就先挤掉最早开的那把 */
    toggleNative(n) {
      if (rig.poolMode !== 'native') { rig.setPool('native'); return; }   // 从共享池点过来：先整池切回（显示全部）
      if (rig.nativeOn.has(n.object)) rig.nativeOn.delete(n.object);
      else {
        while (rig.activeCount() >= 2 && rig.nativeOn.size) {
          const first = [...rig.nativeOn].find((o) => o !== n.object);
          if (!first) break;
          rig.nativeOn.delete(first);
        }
        rig.nativeOn.add(n.object);
      }
      rig.setArmed(rig.armed, rig.activity);
    },
    /** 当前**可见且能用**的原生武器（各自的手 + 类型 + 单手/双手 + 招式表） */
    nativeActives() {
      return nativeList
        .filter((x) => x.object.visible && (x.moves?.length || (x.type && ATTACKS[x.type])))
        .map((x) => ({ ...x, arm: rig.armIndexOf(x.object),
                       moves: x.moves?.length ? x.moves
                              : (x.type && ATTACKS[x.type] ? [ATTACKS[x.type]] : []) }));
    },
    /** 第一把可见原生武器（攻击名 / 时长用） */
    nativeInfo() { return rig.nativeActives()[0] ?? null; },
    get groups() { return entries.map((e) => e.group); },
    combo() {
      const hands = entries.filter((e) => e.def.slot === 'hand').map((e) => e.spec.id).sort();
      const list = COMBOS[hands.join('+')];
      return list ? (list[rig.move] ?? list[0]) : null;
    },
    setArmed(armed, activity, extra = {}) {
      rig.armed = !!armed; rig.activity = activity ?? '';
      if (!rig.bag && entries.some((e) => e.def.slot === 'stowed')) rig.bag = makeWeaponBag(model.body);
      for (const e of entries) {
        const stowed = e.def.slot === 'stowed';
        /* 收纳型武器：收械 → 挂到**背袋**上；持械 → 拿在手里 */
        if (stowed && !rig.armed) {
          if (rig.bag && e.group.parent !== rig.bag) rig.bag.add(e.group);
          const st = e.def.stow ?? {};
          e.group.position.set(...(st.pos ?? [0, 0, 0]));
          e.group.rotation.set(0, 0, 0);
          e.group.scale.setScalar(st.scale ?? 1);
          e.group.visible = true;
          continue;
        }
        const arm = model.arms[e.spec.arm ?? 0];
        if (arm && e.group.parent !== arm) arm.add(e.group);
        e.group.visible = rig.armed && rig.poolMode === 'shared';   // 共享池：装了才显示
        if (!rig.armed) continue;
        if (stowed && e.def.held)
          holdTransform(e.group, arm, { ...e.def.held, mirrorZ: (e.def.hold ?? {}).mirrorZ }, e.spec);
        else holdTransform(e.group, arm, e.def.hold, e.spec);
        /* 武器的**攻击附加**：绕手转（如链锤甩出去）+ 沿握把拉伸（链条绷直） */
        if (extra.wRot) e.group.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(extra.wRot.x || 0, 0, extra.wRot.z || 0)));
        if (extra.wStretch) e.group.scale.x *= extra.wStretch;
      }
      /* ★ 原生武器可见性：**在角色池** + 持械 + 它自己「开着」+ 那只手没被我们的武器占；
         **绑定**的（带 `def`）还要按 hold 摆到手上 */
      const ours = rig.ourArms();
      for (const n of nativeList) {
        if (n.def) { const arm = model.arms[n.spec?.arm ?? 0]; if (arm) holdTransform(n.object, arm, n.def.hold, n.spec); }
        n.object.visible =
          rig.armed && rig.poolMode === 'native' && rig.nativeOn.has(n.object) && !ours.has(rig.armIndexOf(n.object));
      }
    },
    armedArms() {
      const s = new Set();
      if (!rig.armed) return s;
      for (const e of entries) if (e.group.visible && e.def.slot === 'hand') s.add(e.spec.arm ?? 0);
      return s;
    },
    attackPose(u) {
      const out = { arms: {}, bodyRotX: 0, bodyRotY: 0, bodyRotZ: 0, bodyY: 0, brace: 0, w: 0,
                    wRotX: 0, wRotZ: 0, wStretch: 1 };
      const combo = rig.combo();
      if (combo) {
        const p = combo.pose(THREE.MathUtils.clamp(u, 0, 1));
        for (const k in p.arms) { const a = p.arms[k], arm = Number(k);
          out.arms[arm] = { x: a.x ?? 0, z: (a.z ?? 0) * (arm === 0 ? 1 : -1), w: a.w ?? p.w ?? 1 }; }
        out.bodyRotX = p.bodyRotX ?? 0; out.bodyRotY = p.bodyRotY ?? 0; out.bodyRotZ = p.bodyRotZ ?? 0;
        out.bodyY = p.bodyY ?? 0; out.brace = p.brace ?? 0; out.w = p.w ?? 1;
        out.wRotX = p.wRotX ?? 0; out.wRotZ = p.wRotZ ?? 0; out.wStretch = p.wStretch ?? 1;
        return out;
      }
      /* ★ 多把武器 → 排成**动作序列**：同一个招式 → 同时动（如双剑交叉斩）；
         不同招式 → 按手序先后放（如黑岩：**先炮后刀**），不再一起执行 */
      const seq = rig.attackSequence();
      if (!seq.length) return null;
      const n = seq.length;
      seq.forEach((g, i) => {
        const uu = (u - i / n) * n;               // 这一组在自己时间片里的进度
        if (uu < 0) return;                       // 还没轮到 → 这只手待机
        const p = g.move.pose(THREE.MathUtils.clamp(uu, 0, 1));
        for (const arm of g.arms)
          out.arms[arm] = { x: p.armX ?? 0, z: (p.armZ ?? 0) * (arm === 0 ? 1 : -1), w: p.w ?? 1 };
        out.bodyRotX += p.bodyRotX ?? 0; out.bodyRotY += p.bodyRotY ?? 0; out.bodyRotZ += p.bodyRotZ ?? 0;
        out.bodyY += p.bodyY ?? 0; out.brace = Math.max(out.brace, p.brace ?? 0); out.w = Math.max(out.w, p.w ?? 1);
        out.wRotX += p.wRotX ?? 0; out.wRotZ += p.wRotZ ?? 0;
        if (p.wStretch != null) out.wStretch = Math.max(out.wStretch, p.wStretch);
      });
      return out;
    },
    /** 当前武器 → **动作序列**：`[{ move, arms:[…] }]`。同一个 move 合并成一组（同时动），
        不同 move 各成一组、按**手序**（arm 0 → 1）先后播放。 */
    attackSequence() {
      const pairs = [];
      const hand = entries.filter((e) => e.def.slot === 'hand');
      if (hand.length) {
        for (const e of hand) {
          const mv = e.moves[rig.move] ?? e.moves[0];
          if (mv) pairs.push({ arm: e.spec.arm ?? 0, move: mv });
        }
      } else {
        for (const x of rig.nativeActives()) {
          const mv = x.moves[rig.move] ?? x.moves[0];
          if (mv) pairs.push({ arm: x.arm, move: mv });
        }
      }
      const groups = [];
      for (const pr of pairs) {
        let g = groups.find((x) => x.move === pr.move);      // 同一个招式对象 → 同一组（同时）
        if (!g) { g = { move: pr.move, arms: [] }; groups.push(g); }
        if (!g.arms.includes(pr.arm)) g.arms.push(pr.arm);
      }
      groups.sort((a, b) => Math.min(...a.arms) - Math.min(...b.arms));
      return groups;
    },
    attackDuration() {
      const combo = rig.combo();
      if (combo) return combo.duration;
      /* ★ 序列播放 → 各段时长**相加** */
      const sum = rig.attackSequence().reduce((s, g) => s + (g.move.duration || 0), 0);
      return sum || .7;
    },
    attackLabel() {
      const combo = rig.combo();
      if (combo) return combo.label;
      const ls = [...new Set(rig.attackSequence().map((g) => g.move.label).filter(Boolean))];
      return ls.join(' → ');                     // 用箭头表示**先后**
    },
    moveCount() {
      const combo = rig.combo();
      if (combo) return COMBOS[entries.filter((e) => e.def.slot === 'hand').map((e) => e.spec.id).sort().join('+')].length;
      /* ★ 绑定/原生武器也要计入「有几套招」 */
      return Math.max(1, ...entries.map((e) => e.moves.length), ...rig.nativeActives().map((x) => x.moves.length || 1));
    },
    clearArm(a) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.def.slot !== 'hand' || (e.spec.arm ?? 0) !== a) continue;
        e.group.parent?.remove(e.group);
        e.group.traverse((o) => o.geometry?.dispose());
        entries.splice(i, 1);
      }
    },
    equip(id, arm) {
      const def = WEAPONS[id];
      if (!def) return null;
      rig.poolMode = 'shared';                 // ★ 用共享池 → 角色武器池自动让位（互斥）
      rig.nativeOn = new Set();
      const at = (e) => e.spec.arm ?? 0;
      /* 同 id 已在手上 → 先卸掉（避免一把武器挂两份） */
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].spec.id === id) rig.clearArm(at(entries[i]));
      /* 成对武器占两只手：换单手持时**整对一起卸**，不能只卸一半 */
      if (def.slots !== 2 && entries.some((e) => e.def.slots === 2)) { rig.clearArm(0); rig.clearArm(1); }
      /* ★ 只有 2 个绑定点：成对武器（slots:2）直接占双手；否则占一只手 */
      if (def.slots === 2) { rig.clearArm(0); rig.clearArm(1); }
      const used = new Set(entries.filter((e) => e.def.slot === 'hand').map(at));
      const target = arm ?? def.hand ?? ([0, 1].find((a) => !used.has(a)) ?? 0);
      const other = target === 0 ? 1 : 0;
      const occupant = entries.find((e) => e.def.slot === 'hand' && at(e) === target && e.spec.id !== id);
      if (occupant) {
        if (!used.has(other)) { occupant.spec.arm = other; occupant.side = other === 0 ? -1 : 1; }
        else rig.clearArm(target);
      }
      rig.clearArm(target);
      const made = attach({ id, arm: target, side: target === 0 ? -1 : 1 });
      rig.setArmed(rig.armed, rig.activity);      // setArmed 顺手藏起原生武器
      return made;
    },
    unequip(id) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].spec.id !== id) continue;
        const e = entries[i];
        e.group.parent?.remove(e.group);
        e.group.traverse((o) => o.geometry?.dispose());
        entries.splice(i, 1);
      }
      rig.setArmed(rig.armed, rig.activity);      // 手上空了 → 自动还回原生武器
      if (!entries.some((e) => e.def.slot === 'hand')) { rig.poolMode = 'native'; rig.nativeOn = new Set(native.slice(0, 2)); rig.setArmed(rig.armed, rig.activity); }
    },
    clear() { rig.setPool('native'); },
    /** 原生装备：切回**角色武器池** → 显示模型自带的原生武器（最多 2 个手位） */
    native() { rig.poolMode = 'native'; for (const a of [0, 1]) rig.clearArm(a); rig.nativeOn = new Set(native.slice(0, 2)); rig.setArmed(true, rig.activity); },
  };
  /* `startNative`：原作角色默认让**模型里烘着的**原生武器显示、不预装独立建模那套
     （否则会和烘的那把叠在一起）；点「原生装备」才换成独立版。 */
  if (!opts.startNative) { for (const s of loadout) attach({ ...s });
    if (entries.length) { rig.poolMode = 'shared'; rig.nativeOn = new Set(); } }   // 预装了共享武器 → 走共享池
  return rig;
}
