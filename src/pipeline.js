/* ============================================================================
 * 生成流水线（pipeline）—— 提炼自 img2threejs 的 forge/next.py + _shared/workflow_state.py
 *
 * 核心那句话（照抄）：
 *   「对话上下文可丢弃；state.json 才是本地清单的权威。」
 *   "Conversation context is disposable; the local checklist authority is
 *    state.json. Never bypass it by reconstructing progress from chat history."
 *
 * 所以这个文件只做一件事：**把「现在该干什么」变成一个确定性查询**。
 * 任何 AI（或人）在任何一个回合，只要调 pipeline.next() 就知道：
 *   · 现在在哪一步 / 哪一遍
 *   · 这一步要产出什么证据
 *   · 下一步的确切命令是什么
 *   · 循环用掉了几次（每遍 3 次、总计 6 次，到顶硬停）
 *
 * 三条硬规矩（照抄）：
 *   1. 按顺序 —— done/skipped 只能标记「当前那一步」，不能跳号
 *   2. 不留白 —— done 必须带 evidence，skipped 必须带 reason；静默省略禁止
 *   3. 到顶硬停 —— 达到循环上限就 status='stopped'，任何进一步操作一律拒绝
 * ========================================================================== */
import { IOU_BY_PASS } from './quality-gates.js';

export const PIPELINE_VERSION = 1;
export const MAX_PER_PASS = 3;      // img2threejs: maxPerPass 默认 3
export const MAX_TOTAL = 6;         // img2threejs: maxTotal 默认 6

/* ------------------------------------------------------- 复杂度与配额 --- */
/** 照抄 COMPLEXITY_MINIMUMS 的思路，但换成我们这套「部件 / 图元」的计量单位 */
export const COMPLEXITY_MINIMUMS = {
  simple:        { parts:  3, primitives:   8, detailPerPart: 2, identityParts: 2 },
  moderate:      { parts:  6, primitives:  24, detailPerPart: 3, identityParts: 4 },
  complex:       { parts: 10, primitives:  70, detailPerPart: 5, identityParts: 7 },
  'ultra-complex':{ parts: 16, primitives: 150, detailPerPart: 8, identityParts: 11 },
};
export const DEFAULT_COMPLEXITY = 'moderate';

/** 「身份特征组」—— 照抄 qualityContract.featureGroups 的思路。
 *  每一组都必须能被验证，而不是一句形容词。 */
export const FEATURE_GROUPS = [
  { id:'overall-silhouette', name:'整体轮廓与比例',  verify:'gates.silhouette.iou',     failure:'正面剪影对不上参照图' },
  { id:'primary-structure',  name:'主体结构完整',    verify:'contract.parts/primitives', failure:'部件数/图元数不够，或大块缺失' },
  { id:'attachment-correctness', name:'挂接正确（不悬空/不穿插）', verify:'gates.seam + gates.penetration', failure:'部件悬空或互相穿过去' },
  { id:'hair-and-identity',  name:'头发/兽耳/马尾等身份件', verify:'contract.detailPerPart + gates.clearance', failure:'身份件是一个大块，或陷进头骨' },
  { id:'color-palette',      name:'配色',            verify:'palette 覆盖',              failure:'颜色没落到调色板上' },
];

/* ------------------------------------------------------------- 步骤表 --- */
export const SETUP_STEPS = [
  ['reference',  '载入参照图',       "await EditorAPI.setRefImage('<URL 或 dataURL>', { plane:'front', opacity:0.45 })"],
  ['admit',      '参照图可用性判定',  "EditorAPI.admit()"],
  ['palette',    '取主色板',         "EditorAPI.refPalette(6)  → EditorAPI.setPalette({...})"],
  ['complexity', '判定复杂度',       "EditorAPI.setContract({ complexity:'simple|moderate|complex|ultra-complex' })"],
  ['contract',   '写质量契约',       "EditorAPI.setContract({ definitionOfDone:[...], featureGroups:[...] })"],
];

/** 每一遍（pass）里要走的固定小清单 —— 照抄 PASS_STEPS 的模板化 */
export const PASS_STEPS = [
  ['build',  '实现这一遍',        "EditorAPI.addPart / addPrimitive / buildPart / boxify / updatePart …"],
  ['render', '渲染基准视图',      "EditorAPI.render({ pass:true })   → 前后对比图"],
  ['gate',   '跑这一遍的质量门',  "EditorAPI.gates()"],
  ['review', '写入一条评审',      "EditorAPI.record('<action>', {...})"],
];

export const FINAL_STEPS = [
  ['turntable', '转盘全覆盖（0/90/180/270）', "EditorAPI.gates({ turntable:true })"],
  ['export',    '导出',                      "EditorAPI.exportJS() / EditorAPI.exportGLB() / EditorAPI.exportSpecJSON()"],
];

/** 每一遍的**焦点**——告诉 AI「这一遍只干这个，别越界」 */
export const PASS_ORDER = [
  { id:'blockout',   label:'blockout：大形与比例', focus:'只做躯干/头/手臂/腿的大块，把剪影和比例做对。**不要**碰头发细节和饰品。IoU 门槛 0.60。' },
  { id:'structure',  label:'structure：结构',      focus:'四肢分段、附件、左右镜像对、挂接点。每个会动的/独立的东西都要有父级和重叠接缝。IoU 门槛 0.72。' },
  { id:'hair',       label:'hair：头发/兽耳/马尾', focus:'**身份件单独一遍**。必须由多个小模块拼成（发束/分片），不许一个大方块。跑 clearance 门确认没有陷进头骨。IoU 门槛 0.78。' },
  { id:'detail',     label:'detail：小模块与饰品', focus:'饰品/缝线/绑带/饰边。这一遍的目标是小模块数量，不是大形。IoU 门槛 0.80。' },
  { id:'color',      label:'color：配色',          focus:'把颜色落到调色板上，取参考图对应部位的真实颜色。IoU 门槛 0.85（成品标准）。' },
];

/* --------------------------------------------------------- 清单构造 --- */
function stepRow(scope, id, label, command, passId){
  return { id: passId ? `${passId}/${id}` : id, localId:id, scope, passId: passId||null,
    label, command, status:'pending', evidence:[], reason:'' };
}

export function buildChecklist(){
  const rows = [];
  for(const [id,label,cmd] of SETUP_STEPS) rows.push(stepRow('setup', id, label, cmd));
  for(const p of PASS_ORDER) for(const [id,label,cmd] of PASS_STEPS) rows.push(stepRow('pass', id, label, cmd, p.id));
  for(const [id,label,cmd] of FINAL_STEPS) rows.push(stepRow('final', id, label, cmd));
  return rows;
}

export function newState(opts = {}){
  return {
    version: PIPELINE_VERSION,
    status: 'active',                       // active | complete | stopped
    currentStep: null,                      // null = 还没开始
    currentPass: PASS_ORDER[0].id,
    checklist: buildChecklist(),
    loops: { perPass:{}, total:0, maxPerPass: opts.maxPerPass ?? MAX_PER_PASS, maxTotal: opts.maxTotal ?? MAX_TOTAL },
    iterationAction: 'initial',             // initial | new-pass | refine-spec | refine-code
    contract: null,
    history: [],                            // 评审历史（reviewHistory）
    stopReason: '',
    startedAt: null, updatedAt: null,
  };
}

/* ----------------------------------------------------------- 状态机 --- */
export class Pipeline {
  constructor(state){ this.s = state || newState(); }

  /** 序列化（存 localStorage / 导出给下一个 AI 会话）*/
  toJSON(){ return JSON.parse(JSON.stringify(this.s)); }
  static fromJSON(j){ const p = new Pipeline(); if(j && j.checklist) p.s = j; return p; }

  pending(scope){
    return this.s.checklist.filter(r => r.status === 'pending' && (!scope || r.scope === scope));
  }

  /** 下一个该做的条目。顺序：setup 全部 → 当前遍的 pass 行 → final */
  nextEntry(){
    const setup = this.pending('setup');
    if(setup.length) return setup[0];
    const pass = this.pending('pass').filter(r => r.passId === this.s.currentPass);
    if(pass.length) return pass[0];
    // 当前遍做完了 → 等一次「换遍」动作（record('continue') 会推进）
    const final = this.pending('final');
    if(this.passComplete(this.s.currentPass) && final.length) return final[0];
    return null;
  }

  passComplete(passId){
    const rows = this.s.checklist.filter(r => r.passId === passId);
    return rows.length > 0 && rows.every(r => r.status !== 'pending');
  }

  /** ★ 主查询：现在在哪、下一步干什么、命令是什么 */
  status(){
    const next = this.nextEntry();
    const cur = this.s.currentPass;
    const passMeta = PASS_ORDER.find(p => p.id === cur) || null;
    const s = this.s;
    const payload = {
      version: PIPELINE_VERSION,
      status: s.status,
      currentStep: next ? next.id : (s.status === 'complete' ? 'complete' : 'await-pass-transition'),
      currentPass: cur,
      passLabel: passMeta ? passMeta.label : null,
      passFocus: passMeta ? passMeta.focus : null,
      iouThreshold: IOU_BY_PASS[cur] ?? IOU_BY_PASS._default,
      nextCommand: next ? next.command : null,
      nextLabel: next ? next.label : (s.status === 'complete' ? '完成' : `完成 ${cur} 这一遍 → 调 EditorAPI.record('continue', {...})`),
      requiredEvidence: next ? evidenceFor(next) : [],
      loops: s.loops,
      iterationAction: s.iterationAction,
      contract: s.contract,
      // ★ 完整清单也一并给出来 —— 「state 是权威」，AI 不需要靠对话历史拼凑进度
      checklist: s.checklist.map(r=>({ id:r.id, scope:r.scope, passId:r.passId, label:r.label,
        status:r.status, evidence:r.evidence, reason:r.reason, command:r.command,
        isCurrent: !!(next && next.id===r.id) })),
      passOrder: PASS_ORDER.map(p=>({ id:p.id, label:p.label, focus:p.focus })),
      progress: {
        done: s.checklist.filter(r=>r.status==='done').length,
        skipped: s.checklist.filter(r=>r.status==='skipped').length,
        total: s.checklist.length,
      },
      stopReason: s.stopReason || null,
    };
    if(s.status === 'stopped'){
      payload.hardStop = true;
      payload.nextCommand = null;
      payload.note = '★ 硬停：'+s.stopReason+'。不要继续，向用户报告并请求输入。';
    }
    return payload;
  }

  /** 标记一步。按顺序 + 证据要求（照抄 mark_steps 的 in-order 强制）*/
  mark(stepId, { status = 'done', evidence, reason } = {}){
    const s = this.s;
    if(s.status === 'stopped') return { ok:false, error:'流水线已硬停：'+s.stopReason+'（请先 reset 或向用户报告）' };
    const row = s.checklist.find(r => r.id === stepId || r.localId === stepId);
    if(!row) return { ok:false, error:'没有这一步：'+stepId, validIds: s.checklist.filter(r=>r.status==='pending').map(r=>r.id) };
    const next = this.nextEntry();
    if(next && row.id !== next.id)
      return { ok:false, error:`必须按顺序：当前该做的是 ${next.id}（${next.label}），不是 ${row.id}` };
    if(status === 'done' && !(evidence && (Array.isArray(evidence) ? evidence.length : String(evidence).trim())))
      return { ok:false, error:'标记 done 必须带 evidence（这一步的产物/结果），不能空手通过' };
    if(status === 'skipped' && !(reason && String(reason).trim()))
      return { ok:false, error:'标记 skipped 必须带 reason，不许静默省略' };
    row.status = status;
    if(evidence) row.evidence = Array.isArray(evidence) ? evidence : [evidence];
    if(reason) row.reason = String(reason);
    s.currentStep = row.id;
    s.updatedAt = Date.now();
    this.advanceIfPassDone();
    return { ok:true, step:row.id, status, next:this.status() };
  }

  /** 当前这一遍的 4 行都走完了 → 等 record() 来推进 */
  advanceIfPassDone(){
    const s = this.s;
    if(this.passComplete(s.currentPass)){
      const finalDone = this.pending('final').length === 0;
      const setupDone = this.pending('setup').length === 0;
      if(finalDone && setupDone) s.status = 'complete';
    }
  }

  /**
   * 写入一条评审 —— 照抄 reviewHistory 的语义：
   *   continue      ：这一遍通过，换下一遍
   *   refine-spec   ：规格错/浅 → 回去改规格（**不要去改代码掩盖**）
   *   refine-code   ：规格对、实现不对 → 重做这一遍
   *   request-input ：缺信息，向用户提问
   *   stop          ：停
   * continue 必须带 render + 分数 ≥ visualAcceptance（默认 0.7），否则拒绝。
   */
  record(action, payload = {}){
    const s = this.s;
    const VALID = ['continue','refine-spec','refine-code','request-input','stop'];
    if(!VALID.includes(action)) return { ok:false, error:'action 必须是 '+VALID.join('|'), validActions: VALID };
    if(s.status === 'stopped') return { ok:false, error:'流水线已硬停：'+s.stopReason };
    if(action === 'stop'){ s.status = 'stopped'; s.stopReason = payload.reason || 'agent 主动停止'; return { ok:true, action, status:s.status, reason:s.stopReason }; }
    if(action === 'request-input'){ s.status = 'stopped'; s.stopReason = 'request-input: '+(payload.reason||'缺信息'); return { ok:true, action, status:s.status, reason:s.stopReason }; }

    const threshold = payload.threshold ?? 0.7;
    if(action === 'continue'){
      if(!payload.evidence) return { ok:false, error:"continue 必须带 evidence（"+"render 的对比图/render 文件名/gate 报告"+"）" };
      if(payload.score != null && payload.score < threshold)
        return { ok:false, error:`continue 要求分数 ≥ ${threshold}，收到 ${payload.score}。分数不够请用 refine-spec / refine-code。` };
    }

    const passId = payload.passId || s.currentPass;
    s.history.push({ passId, action, at:Date.now(),
      score: payload.score ?? null, evidence: payload.evidence ?? null, note: payload.note || '', gate: payload.gate || null });

    // ★ 评审这一步（<遍>/review）就是 record() 本身 —— 必须在这里标记成 done，
    //   否则 passComplete() 永远为 false，流水线永远走不到收尾、也永远不会自动交还。
    const rev = s.checklist.find(r => r.passId === passId && r.localId === 'review');
    if(rev){
      rev.status = 'done';
      rev.evidence = [action + (payload.score != null ? ('（分数 ' + payload.score + '）') : '')
        + (payload.note ? ' — ' + payload.note : '')];
    }

    if(action === 'continue'){
      // 这一遍通过：标记本遍剩余步骤为 done/skipped 无意义（已 done），直接换遍
      const idx = PASS_ORDER.findIndex(p => p.id === passId);
      const nxt = PASS_ORDER[idx+1];
      if(nxt){ s.currentPass = nxt.id; s.iterationAction = 'new-pass'; }
      else {
        // 所有遍走完 → final
        s.iterationAction = 'new-pass';
      }
      s.updatedAt = Date.now();
      return { ok:true, action, passId, nextPass: nxt ? nxt.id : null, status:this.status() };
    }

    // refine-* → 计循环，到顶就硬停
    s.loops.perPass[passId] = (s.loops.perPass[passId] || 0) + 1;
    s.loops.total += 1;
    s.iterationAction = action;
    if(s.loops.perPass[passId] >= s.loops.maxPerPass){
      s.status = 'stopped';
      s.stopReason = `max-correction-loops-reached:${passId}:${s.loops.perPass[passId]}/${s.loops.maxPerPass}`;
    } else if(s.loops.total >= s.loops.maxTotal){
      s.status = 'stopped';
      s.stopReason = `max-total-correction-loops-reached:${s.loops.total}/${s.loops.maxTotal}`;
    } else {
      // 重置这一遍的 4 行，重新来过
      for(const r of s.checklist) if(r.passId === passId){ r.status = 'pending'; r.evidence = []; r.reason = ''; }
    }
    s.updatedAt = Date.now();
    return { ok:true, action, passId, loops:s.loops, status:this.status() };
  }

  /** 换到指定遍（人工/AI 显式跳遍时用；会重置那一遍）*/
  setPass(passId){
    if(!PASS_ORDER.some(p=>p.id===passId)) return { ok:false, error:'未知的遍：'+passId, valid:PASS_ORDER.map(p=>p.id) };
    this.s.currentPass = passId;
    for(const r of this.s.checklist) if(r.passId === passId){ r.status='pending'; r.evidence=[]; r.reason=''; }
    return { ok:true, currentPass:passId, status:this.status() };
  }

  reset(opts = {}){
    this.s = newState(opts);
    return { ok:true, status:this.status() };
  }
}

function evidenceFor(row){
  switch(row.localId){
    case 'reference': return ['参照图已渲染进视口（render() 能看见）'];
    case 'admit':     return ['admit() 的 admitted 判定与理由'];
    case 'palette':   return ['主色板 hex 列表'];
    case 'complexity':return ['复杂度档位 + 依据（头身比/部件数预估）'];
    case 'contract':  return ['definitionOfDone + featureGroups + 最小配额'];
    case 'build':     return ['这一遍改动的部件 id 列表（变化前后对比）'];
    case 'render':    return ['一张基准视图 PNG（文件名/路径）'];
    case 'gate':      return ['gates() 的完整报告（verdict + 每个门的数字）'];
    case 'review':    return ['action + 分数 + 证据引用'];
    case 'turntable': return ['0/90/180/270 四张轨道图 + turntable 门报告'];
    case 'export':    return ['exportJS 语法通过 + 导出文件名'];
    default:          return [];
  }
}

/* --------------------------------------------------------- 质量契约 --- */
/** 生成一份默认契约（照抄 make_quality_contract 的结构）*/
export function makeContract(complexity = DEFAULT_COMPLEXITY, extra = {}){
  const mins = COMPLEXITY_MINIMUMS[complexity] || COMPLEXITY_MINIMUMS[DEFAULT_COMPLEXITY];
  return {
    qualityBar: complexity,
    definitionOfDone: extra.definitionOfDone || [
      '正面剪影与参照图一致（silhouette 门通过，成品遍 IoU ≥ 0.85）',
      '所有身份特征件由多个小模块组成，不是一个大方块',
      '没有悬空部件（seam 门通过）、没有部件互相穿插（penetration 门通过）',
      '身份件没有陷进宿主（clearance 门通过）',
      '转盘 0/90/180/270 全部有视图且无内部空洞（turntable 门通过）',
      '左右配对的部件互为镜像（chirality 门通过）',
    ],
    minimumSpecDepth: mins,
    featureGroups: FEATURE_GROUPS.map(g => ({ ...g, required:true })),
    antiShallowSpecRules: [
      '复杂对象只有一个根部件 → 不算完成',
      '身份特征件只有一个图元 → 不算完成',
      '可见细节只在描述里、没有落到具体图元上 → 不算完成',
      '相邻独立几何的重叠 < 0.02 世界单位 → 判死（悬空）',
      '「没测」不等于「通过」：任何门报 unevaluated 都不算通过',
    ],
    mustNotDo: [
      '不要一次性生成整个模型（必须逐遍）',
      '不要用一个大方块糊弄头发/马尾/兽耳',
      '不要为了通过门而放宽阈值（门是问题，不是障碍）',
      '不要跳过 render 直接写 review',
    ],
    ...extra,
  };
}

/** 用契约 + 当前 spec 检查「够不够深」（照抄 --strict-quality 的意图）*/
export function checkContract(spec, contract){
  const c = contract || makeContract();
  const mins = c.minimumSpecDepth || {};
  const parts = (spec && spec.parts) || [];
  const prims = parts.reduce((a,p)=>a+((p.primitives||[]).length), 0);
  const identity = parts.filter(p => /发|耳|尾|角|翼|饰|冠|披|围|腰|带/.test((p.name||'')+(p.category||'')));
  const identityPrims = identity.map(p=>({ id:p.id, name:p.name, primitives:(p.primitives||[]).length,
    pass: (p.primitives||[]).length >= (mins.detailPerPart||3) }));
  const gaps = [];
  if(mins.parts    && parts.length  < mins.parts)    gaps.push(`部件数 ${parts.length} < 最低 ${mins.parts}`);
  if(mins.primitives && prims       < mins.primitives) gaps.push(`图元数 ${prims} < 最低 ${mins.primitives}`);
  if(mins.identityParts && identity.length < mins.identityParts) gaps.push(`身份特征件 ${identity.length} < 最低 ${mins.identityParts}`);
  const thin = identityPrims.filter(x=>!x.pass);
  if(thin.length) gaps.push(`身份件图元太少：`+thin.map(x=>`${x.name}(${x.primitives})`).join('、')+`（每件至少 ${mins.detailPerPart}`);
  return { ok: gaps.length === 0, qualityBar:c.qualityBar, minimumSpecDepth:mins,
    actual:{ parts:parts.length, primitives:prims, identityParts:identity.length },
    identityParts: identityPrims, gaps,
    note: gaps.length ? '规格太浅，先补足再往下走（照抄 antiShallowSpecRules）' : '达到本档位的最小深度' };
}
