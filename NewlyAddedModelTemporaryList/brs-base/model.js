/* ============================================================
   由「低模部件编辑器」导出 —— 拉普兰德（拆分版） (lappland)
   依赖：characters.orig.js 的 Q / XT + characters.face.js 的 attachFace；
   用法：const c = build_lappland(); scene.add(c.root);
   ============================================================ */
function build_lappland(){
  const C = { hair:0x17181f, hairShade:0xe0f14, coat:0x26303a, coatShade:0x1c2229, trim:0xe1e5e1, eye:0xbabfc0, skin:0xf1d3bd, metal:0xb7bec6 };
  const Ft = [1.32, 1.316, 1.34];
  const X = THREE.Group;
  const root=new X(), body=new X(), head=new X(),
        armL=new X(), armR=new X(), legL=new X(), legR=new X(), coatTails=new X(), tail=new X();
  root.add(body); body.add(head); body.add(coatTails); body.add(tail); body.add(armL,armR,legL,legR);
  const P={body,head,armL,armR,legL,legR,coatTails,tail};
  const RG={"root":{"p":[0,0,0],"r":[0,0,0],"s":[1.008,1.008,1.008]},"body":{"p":[0,0.48,0],"r":[0,0,0],"s":[1,1,1]},"head":{"p":[0,1.2097,0],"r":[0,0,0],"s":[1.429,1.316,1.297]},"armL":{"p":[-0.36,0.86,0],"r":[0,0,0],"s":[1,1,1]},"armR":{"p":[0.36,0.86,0],"r":[0,0,0],"s":[1,1,1]},"legL":{"p":[-0.127,0.4007,0],"r":[0,0,0],"s":[1,1.05,1]},"legR":{"p":[0.127,0.4007,0],"r":[0,0,0],"s":[1,1.05,1]},"coatTails":{"p":[0,0.92,-0.1],"r":[0,0,0],"s":[1,1,1]},"tail":{"p":[0,0.29,-0.23],"r":[0,0,0],"s":[1,1,1]}};
  for(const k of ['body','head','armL','armR','legL','legR','coatTails','tail']){ const g=RG[k]; if(!g) continue; const o=P[k]; if(!o) continue;
    if(g.p)o.position.set(...g.p); if(g.r)o.rotation.set(...g.r); if(g.s)o.scale.set(...g.s); }
  if(RG.root){ if(RG.root.p)root.position.set(...RG.root.p); if(RG.root.s)root.scale.set(...RG.root.s); }
  // ---- 头发·齐刘海 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.06653379041268383,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.288,0.1807331047936581,0.15257472); m.rotation.set(-0.06,0,0.10079999999999999); m.name="头发·齐刘海 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.09624852469914812,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.192,0.16587573765042593,0.18114431999999997); m.rotation.set(-0.06,0,0.0672); m.name="头发·齐刘海 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.10983994258604673,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.096,0.15908002870697663,0.19828607999999998); m.rotation.set(-0.06,0,0.0336); m.name="头发·齐刘海 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.09983960407798002,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,0.16408019796100998,0.204); m.rotation.set(-0.06,0,0); m.name="头发·齐刘海 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.11932160809995111,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.09599999999999997,0.15433919595002443,0.19828608); m.rotation.set(-0.06,0,-0.03359999999999999); m.name="头发·齐刘海 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.07110139708343978,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.192,0.1784493014582801,0.18114431999999997); m.rotation.set(-0.06,0,-0.0672); m.name="头发·齐刘海 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.11711999999999999,0.08561269979843932,0.132, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.288,0.17119365010078033,0.15257472); m.rotation.set(-0.06,0,-0.10079999999999999); m.name="头发·齐刘海 #7"; }
  // ---- 头发·主帽 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.78,0.26,0.585, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,0.28,-0.055); m.rotation.set(0,0,0); m.name="头发·主帽 #1"; }
  // ---- 头发·顶面 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.645,0.09,0.455, 0x33353f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,0.408,-0.062); m.rotation.set(0,0,0); m.name="头发·顶面 #1"; }
  // ---- 头发·后发板 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.68,0.72,0.36, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,0.06,-0.25); m.rotation.set(0,0,0); m.name="头发·后发板 #1"; }
  // ---- 头发·后脑顶 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.56,0.13,0.15, 0x33353f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,0.31,-0.196); m.rotation.set(0,0,0); m.name="头发·后脑顶 #1"; }
  // ---- 头发·后颈 (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.6,0.2,0.16, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0,-0.15,-0.21); m.rotation.set(0,0,0); m.name="头发·后颈 #1"; }
  // ---- 头发·侧发 L (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.11,0.5,0.44, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.345,0.03,-0.02); m.rotation.set(0,0,0); m.name="头发·侧发 L #1"; }
  // ---- 头发·侧发 R (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.11,0.5,0.44, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.345,0.03,-0.02); m.rotation.set(0,0,0); m.name="头发·侧发 R #1"; }
  // ---- 系带比基尼上衣 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.57,0.24,0.36, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.62,0.01); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.25,0.135,0.06, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.105,0.615,0.196); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.25,0.135,0.06, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.105,0.615,0.196); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.07,0.07,0.045, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.6,0.216); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.4,0.052,0.042, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.648,0.184); m.rotation.set(0,0,0.62); m.name="系带比基尼上衣 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.4,0.052,0.042, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.648,0.184); m.rotation.set(0,0,-0.62); m.name="系带比基尼上衣 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.058,0.18,0.112, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.152,0.762,0.076); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #7"; }
  { const q=new Q(); q.box(0,0,0, 0.058,0.18,0.112, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.152,0.762,0.076); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #8"; }
  // ---- 双层白腰带 + 银扣 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.52,0.1,0.38, 0xf5f4f5, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.36,0.03); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.5,0.09,0.36, 0xf5f4f5, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.305,0.03); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.17,0.16,0.06, 0xb9b9b9, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.35,0.235); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #3"; }
  // ---- 黑色超短裤 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.5,0.18,0.38, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.23,0.03); m.rotation.set(0,0,0); m.name="黑色超短裤 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.14,0.26, 0x1b1c23, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.255,0.215,-0.01); m.rotation.set(0,0,0); m.name="黑色超短裤 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.14,0.26, 0x1b1c23, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.255,0.215,-0.01); m.rotation.set(0,0,0); m.name="黑色超短裤 #3"; }
  // ---- 颈圈 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.23,0.08,0.25, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.94,0.05); m.rotation.set(0,0,0); m.name="颈圈 #1"; }
  // ---- 胸腔 (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.54,0.29,0.32, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.815,0.01); m.rotation.set(0,0,0); m.name="胸腔 #1"; }
  // ---- 腰腹 (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.36,0.25,0.26, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.595,0.01); m.rotation.set(0,0,0); m.name="腰腹 #1"; }
  // ---- 骨盆 (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.44,0.32,0.3, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.38,0.01); m.rotation.set(0,0,0); m.name="骨盆 #1"; }
  // ---- 大腿 L (基础腿部) ----
  { const q=new Q(); q.box(0,0,0, 0.15,0.5324,0.155, 0xf4e4dc, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.2259,0.005); m.rotation.set(0,0,0); m.name="大腿 L #1"; }
  // ---- 大腿 R (基础腿部) ----
  { const q=new Q(); q.box(0,0,0, 0.15,0.5324,0.155, 0xf4e4dc, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.2259,0.005); m.rotation.set(0,0,0); m.name="大腿 R #1"; }
  // ---- bL (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.152,0.3,0.158, 0xd0e13, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.6145,0.005); m.rotation.set(0,0,0); m.name="bL #1"; }
  { const q=new Q(); q.shape([[0.058,0.0167],[-0.0336,0.0107],[-0.0245,-0.0273]], 0, 0.006, 0xf5f4f5);
    const m=q.build(P.legL, 0.05); m.position.set(-0.06823333333333333,-0.5127666666666667,0.086); m.name="bL #2"; }
  { const q=new Q(); q.shape([[0.058,0.0167],[-0.0336,0.0107],[-0.0245,-0.0273]], 0, 0.013, 0x1b1c23);
    const m=q.build(P.legL, 0.05); m.position.set(-0.06223333333333333,-0.5197666666666666,0.086); m.name="bL #3"; }
  { const q=new Q(); q.shape([[-0.05,0.0147],[0.0295,0.0087],[0.0204,-0.0233]], 0, 0.006, 0xf5f4f5);
    const m=q.build(P.legL, 0.05); m.position.set(0.06016666666666667,-0.5107666666666667,0.086); m.name="bL #4"; }
  { const q=new Q(); q.shape([[-0.05,0.0147],[0.0295,0.0087],[0.0204,-0.0233]], 0, 0.013, 0x1b1c23);
    const m=q.build(P.legL, 0.05); m.position.set(0.05416666666666666,-0.5177666666666667,0.086); m.name="bL #5"; }
  { const q=new Q(); q.box(0,0,0, 0.011,0.058,0.01, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(-0.024,-0.5501,0.084); m.rotation.set(0,0,0); m.name="bL #6"; }
  { const q=new Q(); q.box(0,0,0, 0.011,0.058,0.01, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0.024,-0.5501,0.084); m.rotation.set(0,0,0); m.name="bL #7"; }
  { const q=new Q(); q.box(0,0,0, 0.022,0.02,0.009, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.5841,0.085); m.rotation.set(0,0,0); m.name="bL #8"; }
  { const q=new Q(); q.box(0,0,0, 0.144,0.067,0.198, 0xd0e13, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.774,0.045); m.rotation.set(0,0,0); m.name="bL #9"; }
  { const q=new Q(); q.box(0,0,0, 0.156,0.038,0.208, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.8264,0.048); m.rotation.set(0,0,0); m.name="bL #10"; }
  // ---- bR (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.152,0.3,0.158, 0xd0e13, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.6145,0.005); m.rotation.set(0,0,0); m.name="bR #1"; }
  { const q=new Q(); q.shape([[-0.058,0.0167],[0.0336,0.0107],[0.0245,-0.0273]], 0, 0.006, 0xf5f4f5);
    const m=q.build(P.legR, 0.05); m.position.set(0.06823333333333333,-0.5127666666666667,0.086); m.name="bR #2"; }
  { const q=new Q(); q.shape([[-0.058,0.0167],[0.0336,0.0107],[0.0245,-0.0273]], 0, 0.013, 0x1b1c23);
    const m=q.build(P.legR, 0.05); m.position.set(0.06223333333333333,-0.5197666666666666,0.086); m.name="bR #3"; }
  { const q=new Q(); q.shape([[0.05,0.0147],[-0.0295,0.0087],[-0.0204,-0.0233]], 0, 0.006, 0xf5f4f5);
    const m=q.build(P.legR, 0.05); m.position.set(-0.06016666666666667,-0.5107666666666667,0.086); m.name="bR #4"; }
  { const q=new Q(); q.shape([[0.05,0.0147],[-0.0295,0.0087],[-0.0204,-0.0233]], 0, 0.013, 0x1b1c23);
    const m=q.build(P.legR, 0.05); m.position.set(-0.05416666666666666,-0.5177666666666667,0.086); m.name="bR #5"; }
  { const q=new Q(); q.box(0,0,0, 0.011,0.058,0.01, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(-0.024,-0.5501,0.084); m.rotation.set(0,0,0); m.name="bR #6"; }
  { const q=new Q(); q.box(0,0,0, 0.011,0.058,0.01, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0.024,-0.5501,0.084); m.rotation.set(0,0,0); m.name="bR #7"; }
  { const q=new Q(); q.box(0,0,0, 0.022,0.02,0.009, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.5841,0.085); m.rotation.set(0,0,0); m.name="bR #8"; }
  { const q=new Q(); q.box(0,0,0, 0.144,0.067,0.198, 0xd0e13, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.774,0.045); m.rotation.set(0,0,0); m.name="bR #9"; }
  { const q=new Q(); q.box(0,0,0, 0.156,0.038,0.208, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.8264,0.048); m.rotation.set(0,0,0); m.name="bR #10"; }
  // ---- 大臂 L (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.18,0.28,0.19, 0xd0e13, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0.025,-0.081,0); m.rotation.set(0,0,0.1); m.name="大臂 L #1"; }
  // ---- 小臂 L (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.165,0.28,0.175, 0xd0e13, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.321,0); m.rotation.set(0,0,0.05); m.name="小臂 L #1"; }
  // ---- 手 L (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.17,0.22,0.17, 0xd0e13, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(-0.012,-0.531,0); m.rotation.set(0,0,0); m.name="手 L #1"; }
  // ---- 大臂 R (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.18,0.28,0.19, 0xd0e13, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(-0.025,-0.081,0); m.rotation.set(0,0,-0.1); m.name="大臂 R #1"; }
  // ---- 小臂 R (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.165,0.28,0.175, 0xd0e13, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.321,0); m.rotation.set(0,0,-0.05); m.name="小臂 R #1"; }
  // ---- 手 R (基础手臂（含手）) ----
  { const q=new Q(); q.box(0,0,0, 0.17,0.22,0.17, 0xd0e13, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0.012,-0.531,0); m.rotation.set(0,0,0); m.name="手 R #1"; }
  // ---- 黑色手套 L (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.186,0.19,0.186, 0xd0e13, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(-0.012,-0.531,0); m.rotation.set(0,0,0); m.name="黑色手套 L #1"; }
  { const q=new Q(); q.box(0,0,0, 0.176,0.03,0.18, 0xf5f4f5, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(-0.012,-0.443,0); m.rotation.set(0,0,0); m.name="黑色手套 L #2"; }
  // ---- 黑色手套 R (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.186,0.19,0.186, 0xd0e13, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0.012,-0.531,0); m.rotation.set(0,0,0); m.name="黑色手套 R #1"; }
  { const q=new Q(); q.box(0,0,0, 0.176,0.03,0.18, 0xf5f4f5, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0.012,-0.443,0); m.rotation.set(0,0,0); m.name="黑色手套 R #2"; }
  // ---- 双马尾 L (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.36,0.4,-0.06); m.rotation.set(0,0,-0.62); m.name="双马尾 L #1"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.24,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.5,0.24,-0.06); m.rotation.set(0,0,-0.85); m.name="双马尾 L #2"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.18,0.2, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.57,0.1,-0.06); m.rotation.set(0,0,-1.15); m.name="双马尾 L #3"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.44,0.22, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.5,-0.22,-0.07); m.rotation.set(0,0,-0.08); m.name="双马尾 L #4"; }
  { const q=new Q(); q.box(0,0,0, 0.17,0.4,0.19, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.45,-0.52,-0.08); m.rotation.set(0,0,0.02); m.name="双马尾 L #5"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.3,0.15, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.4,-0.78,-0.09); m.rotation.set(0,0,0.06); m.name="双马尾 L #6"; }
  { const q=new Q(); q.box(0,0,0, 0.11,0.34,0.13, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.56,-0.3,-0.07); m.rotation.set(0,0,-0.2); m.name="双马尾 L #7"; }
  // ---- 双马尾 R (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.36,0.4,-0.06); m.rotation.set(0,0,0.62); m.name="双马尾 R #1"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.24,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.5,0.24,-0.06); m.rotation.set(0,0,0.85); m.name="双马尾 R #2"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.18,0.2, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.57,0.1,-0.06); m.rotation.set(0,0,1.15); m.name="双马尾 R #3"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.44,0.22, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.5,-0.22,-0.07); m.rotation.set(0,0,0.08); m.name="双马尾 R #4"; }
  { const q=new Q(); q.box(0,0,0, 0.17,0.4,0.19, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.45,-0.52,-0.08); m.rotation.set(0,0,-0.02); m.name="双马尾 R #5"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.3,0.15, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.4,-0.78,-0.09); m.rotation.set(0,0,-0.06); m.name="双马尾 R #6"; }
  { const q=new Q(); q.box(0,0,0, 0.11,0.34,0.13, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.56,-0.3,-0.07); m.rotation.set(0,0,0.2); m.name="双马尾 R #7"; }
  // ---- 双马尾 R (镜像) (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.36,0.4,-0.06); m.rotation.set(0,0,-0.62); m.name="双马尾 R (镜像) #1"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.24,0.26, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.5,0.24,-0.06); m.rotation.set(0,0,-0.85); m.name="双马尾 R (镜像) #2"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.18,0.2, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.57,0.1,-0.06); m.rotation.set(0,0,-1.15); m.name="双马尾 R (镜像) #3"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.44,0.22, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.5,-0.22,-0.07); m.rotation.set(0,0,-0.08); m.name="双马尾 R (镜像) #4"; }
  { const q=new Q(); q.box(0,0,0, 0.17,0.4,0.19, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.45,-0.52,-0.08); m.rotation.set(0,0,0.02); m.name="双马尾 R (镜像) #5"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.3,0.15, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.4,-0.78,-0.09); m.rotation.set(0,0,0.06); m.name="双马尾 R (镜像) #6"; }
  { const q=new Q(); q.box(0,0,0, 0.11,0.34,0.13, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.56,-0.3,-0.07); m.rotation.set(0,0,-0.2); m.name="双马尾 R (镜像) #7"; }
  attachFace(head, { id:"lappland", iris:[0x1e5fbf,0x4f9be8,0xd8ecff] });
  return { root, body, head, arms:[armL,armR], legs:[legL,legR], coatTails, tail };
}