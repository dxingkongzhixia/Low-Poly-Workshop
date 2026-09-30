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
  const RG={"root":{"p":[0,0,0],"r":[0,0,0],"s":[1.008,1.008,1.008]},"body":{"p":[0,0.48,0],"r":[0,0,0],"s":[1,1,1]},"head":{"p":[0,1.2097,0],"r":[0,0,0],"s":[1.429,1.316,1.297]},"armL":{"p":[-0.36,0.86,0],"r":[0,0,0],"s":[1,1,1]},"armR":{"p":[0.36,0.86,0],"r":[0,0,0],"s":[1,1,1]},"legL":{"p":[-0.16,0.4007,0],"r":[0,0,0],"s":[1,1.05,1]},"legR":{"p":[0.16,0.4007,0],"r":[0,0,0],"s":[1,1.05,1]},"coatTails":{"p":[0,0.92,-0.1],"r":[0,0,0],"s":[1,1,1]},"tail":{"p":[0,0.29,-0.23],"r":[0,0,0],"s":[1,1,1]}};
  for(const k of ['body','head','armL','armR','legL','legR','coatTails','tail']){ const g=RG[k]; if(!g) continue; const o=P[k]; if(!o) continue;
    if(g.p)o.position.set(...g.p); if(g.r)o.rotation.set(...g.r); if(g.s)o.scale.set(...g.s); }
  if(RG.root){ if(RG.root.p)root.position.set(...RG.root.p); if(RG.root.s)root.scale.set(...RG.root.s); }
  // ---- 原作图元拆分器（保留原始形状：倒角/斜切/多边形挤出）----
  const SRCID="lappland";
  const SKIP=[];
  const _src=XT(SRCID); _src.root.updateMatrixWorld(true);
  const MESHTAB=[]; _src.root.traverse(o=>{ if(o.isMesh && o.geometry && o.geometry.userData && o.geometry.userData.primitiveVertexCounts && !SKIP.includes(o.name)) MESHTAB.push(o); });
  function __op(role,mi,pi,tris,pos,rot,scl,color,mir,name,metal,rough){
    const o=MESHTAB[mi]; if(!o) return;
    const target = (P[role]||body); target.updateWorldMatrix(true,false);
    const M=new THREE.Matrix4().copy(target.matrixWorld).invert().multiply(o.matrixWorld);
    const NM=new THREE.Matrix3().getNormalMatrix(M);
    const counts=o.geometry.userData.primitiveVertexCounts, cnt=counts[pi];
    let off=0; for(let i=0;i<pi;i++) off+=counts[i];
    const pa=o.geometry.getAttribute('position'), na=o.geometry.getAttribute('normal'), ca=o.geometry.getAttribute('color');
    const list = (tris && tris.length) ? tris : Array.from({length:cnt/3},(_,i)=>i);
    const vn=list.length*3, PP=new Float32Array(vn*3), NN=new Float32Array(vn*3), CC=new Float32Array(vn*3);
    const p=new THREE.Vector3(), nv=new THREE.Vector3(); let w=0, sx0=0, sy0=0, sz0=0;
    for(const t of list){ for(let k=0;k<3;k++){ const i=off+t*3+k;
      p.set(pa.getX(i),pa.getY(i),pa.getZ(i)).applyMatrix4(M);
      PP[w*3]=p.x; PP[w*3+1]=p.y; PP[w*3+2]=p.z; sx0+=p.x; sy0+=p.y; sz0+=p.z;
      if(na){ nv.set(na.getX(i),na.getY(i),na.getZ(i)).applyMatrix3(NM).normalize(); NN[w*3]=nv.x; NN[w*3+1]=nv.y; NN[w*3+2]=nv.z; }
      CC[w*3]=ca?ca.getX(i):1; CC[w*3+1]=ca?ca.getY(i):1; CC[w*3+2]=ca?ca.getZ(i):1; w++; } }
    for(let k=0;k<w;k++){ PP[k*3]-=sx0/w; PP[k*3+1]-=sy0/w; PP[k*3+2]-=sz0/w; }
    if(mir){ for(let k=0;k<w;k++){ PP[k*3]=-PP[k*3]; NN[k*3]=-NN[k*3]; }
      for(let t=0;t<w;t+=3){ for(let j=0;j<3;j++){
        let a=PP[(t+1)*3+j]; PP[(t+1)*3+j]=PP[(t+2)*3+j]; PP[(t+2)*3+j]=a;
        a=NN[(t+1)*3+j]; NN[(t+1)*3+j]=NN[(t+2)*3+j]; NN[(t+2)*3+j]=a;
        a=CC[(t+1)*3+j]; CC[(t+1)*3+j]=CC[(t+2)*3+j]; CC[(t+2)*3+j]=a; } } }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(PP,3));
    g.setAttribute('normal',new THREE.BufferAttribute(NN,3));
    g.setAttribute('color',new THREE.BufferAttribute(CC,3));
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:(rough==null?0.69:rough),metalness:(metal==null?0.05:metal)}));
    m.castShadow=true; m.receiveShadow=true; m.name=name;
    m.userData.__op={ src:SRCID, mesh:mi, prim:pi };
    m.position.set(mir?-pos[0]:pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], mir?-rot[1]:rot[1], mir?-rot[2]:rot[2]); m.scale.set(scl[0],scl[1],scl[2]);
    target.add(m);
  }
  // ---- 后摆·后摆 (额外装饰) ----
  __op("coatTails",4,0,null,[-0.2237,-0.1833,0],[0,0,0],[1,1,1],null,false,"后摆·后摆 #1",0.05,0.69);
  __op("coatTails",4,1,null,[0.2254,-0.1954,0],[0,0,0],[1,1,1],null,false,"后摆·后摆 #2",0.05,0.69);
  // ---- 左腿·大腿 (腿部装饰) ----
  __op("legL",7,0,[1,2,3,4,5,6,16,19,20,21,22,23,24,25,26,27,28,29,30,31,32,35,36,37,38,39,40,41,42,43],[0,-0.0618,0],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #1",0.05,0.69);
  __op("legL",8,0,null,[-0.1001,-0.1028,0.0619],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #2",0.05,0.69);
  __op("legL",8,1,null,[-0.076,-0.1537,0.086],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #3",0.05,0.69);
  __op("legL",8,2,[0,2,3,5,9,10,11,12,13,14,15],[-0.1128,-0.1958,0.0493],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #4",0.05,0.69);
  __op("legL",9,0,null,[-0.0373,-0.1187,0.1075],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #5",0.05,0.69);
  __op("legL",9,1,null,[0.0121,-0.171,0.1075],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #6",0.05,0.69);
  __op("legL",9,2,[2,5,10,11,12,13],[-0.0286,-0.2143,0.1075],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #7",0.05,0.69);
  __op("legL",10,0,null,[0,-0.025,0],[0,0,0],[1,1,1],C.skin,false,"左腿·大腿 #8",0.05,0.69);
  // ---- 左臂·小臂 (手臂装饰) ----
  __op("armL",11,0,[0,1,2,3,4,5,18,19,20,21,22,23,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,72,73,74,75,76,77,90,91,92,93,94,95],[0,-0.4281,0.04],[0,0,0],[1,1,1],null,false,"左臂·小臂 #1",0.05,0.69);
  __op("armL",12,0,[12,13,14,15,16,17,30,31,32,33,34,35,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,84,85,86,87,88,89,102,103,104,105,106,107],[0,-0.2778,0],[0,0,0],[1,1,1],null,false,"左臂·小臂 #2",0.05,0.69);
  __op("armL",12,1,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107],[0,-0.3346,0.02],[0,0,0],[1,1,1],null,false,"左臂·小臂 #3",0.05,0.69);
  __op("armL",12,2,null,[0,-0.4,0.035],[0,0,0],[1,1,1],null,false,"左臂·小臂 #4",0.05,0.69);
  // ---- 左臂·手 (手臂装饰) ----
  __op("armL",11,0,[6,7,8,9,10,11,12,13,14,15,16,17,24,25,26,27,28,29,30,31,32,33,34,35,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,78,79,80,81,82,83,84,85,86,87,88,89,96,97,98,99,100,101,102,103,104,105,106,107],[0,-0.513,0.04],[0,0,0],[1,1,1],null,false,"左臂·手 #1",0.05,0.69);
  // ---- 左臂·大臂 (额外装饰) ----
  __op("armL",12,0,[0,1,2,3,4,5,6,7,8,9,10,11,18,19,20,21,22,23,24,25,26,27,28,29,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,72,73,74,75,76,77,78,79,80,81,82,83,90,91,92,93,94,95,96,97,98,99,100,101],[0,-0.0686,0],[0,0,0],[1,1,1],null,false,"左臂·大臂 #1",0.05,0.69);
  __op("armL",12,1,[37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],[0,-0.2362,0.02],[0,0,0],[1,1,1],null,false,"左臂·大臂 #2",0.05,0.69);
  __op("armL",12,3,null,[-0.12,-0.12,0.08],[0,0,0],[1,1,1],null,false,"左臂·大臂 #3",0.05,0.69);
  // ---- 右腿·大腿 (腿部装饰) ----
  __op("legR",16,0,[1,2,3,4,5,6,16,19,20,21,22,23,24,25,26,27,28,29,30,31,32,35,36,37,38,39,40,41,42,43],[0,-0.0618,0],[0,0,0],[1,1,1],C.skin,false,"右腿·大腿 #1",0.05,0.69);
  __op("legR",17,0,null,[0,-0.025,0],[0,0,0],[1,1,1],C.skin,false,"右腿·大腿 #2",0.05,0.69);
  // ---- 右臂·小臂 (手臂装饰) ----
  __op("armR",18,0,[0,1,2,3,4,5,18,19,20,21,22,23,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,72,73,74,75,76,77,90,91,92,93,94,95],[0,-0.4281,0.04],[0,0,0],[1,1,1],null,false,"右臂·小臂 #1",0.05,0.69);
  __op("armR",19,0,[12,13,14,15,16,17,30,31,32,33,34,35,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,84,85,86,87,88,89,102,103,104,105,106,107],[0,-0.2778,0],[0,0,0],[1,1,1],null,false,"右臂·小臂 #2",0.05,0.69);
  __op("armR",19,1,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107],[0,-0.3346,0.02],[0,0,0],[1,1,1],null,false,"右臂·小臂 #3",0.05,0.69);
  __op("armR",19,2,null,[0,-0.4,0.035],[0,0,0],[1,1,1],null,false,"右臂·小臂 #4",0.05,0.69);
  // ---- 右臂·手 (手臂装饰) ----
  __op("armR",18,0,[6,7,8,9,10,11,12,13,14,15,16,17,24,25,26,27,28,29,30,31,32,33,34,35,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,78,79,80,81,82,83,84,85,86,87,88,89,96,97,98,99,100,101,102,103,104,105,106,107],[0,-0.513,0.04],[0,0,0],[1,1,1],null,false,"右臂·手 #1",0.05,0.69);
  // ---- 右臂·大臂 (额外装饰) ----
  __op("armR",19,0,[0,1,2,3,4,5,6,7,8,9,10,11,18,19,20,21,22,23,24,25,26,27,28,29,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,72,73,74,75,76,77,78,79,80,81,82,83,90,91,92,93,94,95,96,97,98,99,100,101],[0,-0.0686,0],[0,0,0],[1,1,1],null,false,"右臂·大臂 #1",0.05,0.69);
  __op("armR",19,1,[37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],[0,-0.2362,0.02],[0,0,0],[1,1,1],null,false,"右臂·大臂 #2",0.05,0.69);
  __op("armR",19,3,null,[0.12,-0.12,0.08],[0,0,0],[1,1,1],null,false,"右臂·大臂 #3",0.05,0.69);
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
  // ---- 外套下摆（开襟长摆） (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.62,0.74,0.22, 0x14151b, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0,-0.34,-0.15); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #1"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.72,0.4, 0x14151b, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.385,-0.3,-0.08); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #2"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.72,0.4, 0x14151b, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.385,-0.3,-0.08); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #3"; }
  { const q=new Q(); q.box(0,0,0, 0.11,0.64,0.14, 0x14151b, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.285,-0.36,0.11); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #4"; }
  { const q=new Q(); q.box(0,0,0, 0.11,0.64,0.14, 0x14151b, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.285,-0.36,0.11); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #5"; }
  { const q=new Q(); q.box(0,0,0, 0.58,0.05,0.22, 0xf5f4f5, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0,-0.62,-0.15); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #6"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.05,0.38, 0xf5f4f5, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.3,-0.6,-0.08); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #7"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.05,0.38, 0xf5f4f5, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.3,-0.6,-0.08); m.rotation.set(0,0,0); m.name="外套下摆（开襟长摆） #8"; }
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
  // ---- 双马尾 L (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.26,0.32, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.25,0.3,-0.05); m.rotation.set(0,0,-0.45); m.name="双马尾 L #1"; }
  { const q=new Q(); q.box(0,0,0, 0.26,0.16,0.24, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.38,0.14,-0.06); m.rotation.set(0,0,-0.95); m.name="双马尾 L #2"; }
  { const q=new Q(); q.box(0,0,0, 0.19,0.13,0.18, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.49,-0.02,-0.08); m.rotation.set(0,0,-1.35); m.name="双马尾 L #3"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.42,0.16, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.44,-0.22,-0.1); m.rotation.set(0,0,-0.05); m.name="双马尾 L #4"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.42,0.14, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.42,-0.56,-0.12); m.rotation.set(0,0,0); m.name="双马尾 L #5"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.3,0.11, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.32,-0.8,-0.13); m.rotation.set(0,0,0.05); m.name="双马尾 L #6"; }
  { const q=new Q(); q.box(0,0,0, 0.09,0.28,0.1, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.52,-0.36,-0.1); m.rotation.set(0,0,-0.2); m.name="双马尾 L #7"; }
  // ---- 双马尾 R (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.26,0.32, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.25,0.3,-0.05); m.rotation.set(0,0,0.45); m.name="双马尾 R #1"; }
  { const q=new Q(); q.box(0,0,0, 0.26,0.16,0.24, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.38,0.14,-0.06); m.rotation.set(0,0,0.95); m.name="双马尾 R #2"; }
  { const q=new Q(); q.box(0,0,0, 0.19,0.13,0.18, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.49,-0.02,-0.08); m.rotation.set(0,0,1.35); m.name="双马尾 R #3"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.42,0.16, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.44,-0.22,-0.1); m.rotation.set(0,0,0.05); m.name="双马尾 R #4"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.42,0.14, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.42,-0.56,-0.12); m.rotation.set(0,0,0); m.name="双马尾 R #5"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.3,0.11, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.32,-0.8,-0.13); m.rotation.set(0,0,-0.05); m.name="双马尾 R #6"; }
  { const q=new Q(); q.box(0,0,0, 0.09,0.28,0.1, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.52,-0.36,-0.1); m.rotation.set(0,0,0.2); m.name="双马尾 R #7"; }
  // ---- 双马尾 R (镜像) (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.26,0.32, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.25,0.3,-0.05); m.rotation.set(0,0,-0.45); m.name="双马尾 R (镜像) #1"; }
  { const q=new Q(); q.box(0,0,0, 0.26,0.16,0.24, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.38,0.14,-0.06); m.rotation.set(0,0,-0.95); m.name="双马尾 R (镜像) #2"; }
  { const q=new Q(); q.box(0,0,0, 0.19,0.13,0.18, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.49,-0.02,-0.08); m.rotation.set(0,0,-1.35); m.name="双马尾 R (镜像) #3"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.42,0.16, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.44,-0.22,-0.1); m.rotation.set(0,0,-0.05); m.name="双马尾 R (镜像) #4"; }
  { const q=new Q(); q.box(0,0,0, 0.13,0.42,0.14, 0xe0f14, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.42,-0.56,-0.12); m.rotation.set(0,0,0); m.name="双马尾 R (镜像) #5"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.3,0.11, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.32,-0.8,-0.13); m.rotation.set(0,0,0.05); m.name="双马尾 R (镜像) #6"; }
  { const q=new Q(); q.box(0,0,0, 0.09,0.28,0.1, 0x17181f, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.52,-0.36,-0.1); m.rotation.set(0,0,-0.2); m.name="双马尾 R (镜像) #7"; }
  // ---- 系带比基尼上衣 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.46,0.16,0.3, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.9,0.15); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.18,0.085,0.05, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.105,0.9,0.295); m.rotation.set(0,0,0.35); m.name="系带比基尼上衣 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.18,0.085,0.05, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.105,0.9,0.295); m.rotation.set(0,0,-0.35); m.name="系带比基尼上衣 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.38,0.05,0.035, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.912,0.305); m.rotation.set(0,0,0.55); m.name="系带比基尼上衣 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.38,0.05,0.035, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.912,0.305); m.rotation.set(0,0,-0.55); m.name="系带比基尼上衣 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.055,0.15,0.1, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.15,1.02,0.09); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.055,0.15,0.1, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.15,1.02,0.09); m.rotation.set(0,0,0); m.name="系带比基尼上衣 #7"; }
  // ---- 双层白腰带 + 银扣 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.52,0.09,0.42, 0xf5f4f5, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.565,0.09); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.5,0.08,0.4, 0xf5f4f5, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.49,0.09); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.17,0.17,0.06, 0xb9b9b9, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.55,0.27); m.rotation.set(0,0,0); m.name="双层白腰带 + 银扣 #3"; }
  // ---- 黑色超短裤 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.5,0.16,0.38, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.44,0.05); m.rotation.set(0,0,0); m.name="黑色超短裤 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.13,0.26, 0x1b1c23, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.26,0.42,0.01); m.rotation.set(0,0,0); m.name="黑色超短裤 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.13,0.26, 0x1b1c23, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.26,0.42,0.01); m.rotation.set(0,0,0); m.name="黑色超短裤 #3"; }
  // ---- 颈圈 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.27,0.1,0.29, 0xd0e13, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.87,0.05); m.rotation.set(0,0,0); m.name="颈圈 #1"; }
  // ---- 连帽兜（背） (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.5,0.3,0.24, 0x14151b, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.9,-0.24); m.rotation.set(0,0,0); m.name="连帽兜（背） #1"; }
  // ---- 背部大五角星 (服装装饰) ----
  { const q=new Q(); q.shape([[0,-0.2],[0.0505,-0.0696],[0.1902,-0.0618],[0.0818,0.0266],[0.1176,0.1618],[0,0.086],[-0.1176,0.1618],[-0.0818,0.0266],[-0.1902,-0.0618],[-0.0505,-0.0696]], 0, 0.16, 0xf5f4f5);
    const m=q.build(P.coatTails, 0.05); m.position.set(1.3877787807814458e-18,-0.11000000000000001,-0.16); m.name="背部大五角星 #1"; }
  // ---- 黑色手套 L (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.21,0.16,0.23, 0xd0e13, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(-0.02,-0.62,0.06); m.rotation.set(0,0,0); m.name="黑色手套 L #1"; }
  { const q=new Q(); q.box(0,0,0, 0.22,0.05,0.24, 0xf5f4f5, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(-0.02,-0.53,0.06); m.rotation.set(0,0,0); m.name="黑色手套 L #2"; }
  // ---- 黑色手套 R (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.21,0.16,0.23, 0xd0e13, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0.02,-0.62,0.06); m.rotation.set(0,0,0); m.name="黑色手套 R #1"; }
  { const q=new Q(); q.box(0,0,0, 0.22,0.05,0.24, 0xf5f4f5, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0.02,-0.53,0.06); m.rotation.set(0,0,0); m.name="黑色手套 R #2"; }
  // ---- 袖口白饰线 L (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.04,0.22, 0xf5f4f5, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.505,0.06); m.rotation.set(0,0,0); m.name="袖口白饰线 L #1"; }
  // ---- 袖口白饰线 R (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.04,0.22, 0xf5f4f5, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.505,0.06); m.rotation.set(0,0,0); m.name="袖口白饰线 R #1"; }
  // ---- 高筒靴 L（三角靴翼） (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.5,0.28, 0xd0e13, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.462,0.005); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #1"; }
  { const q=new Q(); q.shape([[0.1133,0.0633],[-0.0687,0.0413],[-0.0447,-0.1047]], 0, 0.03, 0xf5f4f5);
    const m=q.build(P.legL, 0.05); m.position.set(-0.19333333333333336,-0.29333333333333333,0.128); m.name="高筒靴 L（三角靴翼） #2"; }
  { const q=new Q(); q.shape([[0.1133,0.0633],[-0.0687,0.0413],[-0.0447,-0.1047]], 0, 0.055, 0x1b1c23);
    const m=q.build(P.legL, 0.05); m.position.set(-0.16933333333333334,-0.3213333333333333,0.128); m.name="高筒靴 L（三角靴翼） #3"; }
  { const q=new Q(); q.box(0,0,0, 0.024,0.12,0.02, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(-0.048,-0.33,0.15); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #4"; }
  { const q=new Q(); q.box(0,0,0, 0.024,0.12,0.02, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0.048,-0.33,0.15); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #5"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.042,0.018, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.4,0.152); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #6"; }
  { const q=new Q(); q.box(0,0,0, 0.28,0.114,0.4, 0xd0e13, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.738,0.055); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #7"; }
  { const q=new Q(); q.box(0,0,0, 0.3,0.052,0.42, 0xf5f4f5, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.817,0.058); m.rotation.set(0,0,0); m.name="高筒靴 L（三角靴翼） #8"; }
  // ---- 高筒靴 R（三角靴翼） (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.5,0.28, 0xd0e13, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.462,0.005); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #1"; }
  { const q=new Q(); q.shape([[-0.1133,0.0633],[0.0687,0.0413],[0.0447,-0.1047]], 0, 0.03, 0xf5f4f5);
    const m=q.build(P.legR, 0.05); m.position.set(0.19333333333333336,-0.29333333333333333,0.128); m.name="高筒靴 R（三角靴翼） #2"; }
  { const q=new Q(); q.shape([[-0.1133,0.0633],[0.0687,0.0413],[0.0447,-0.1047]], 0, 0.055, 0x1b1c23);
    const m=q.build(P.legR, 0.05); m.position.set(0.16933333333333334,-0.3213333333333333,0.128); m.name="高筒靴 R（三角靴翼） #3"; }
  { const q=new Q(); q.box(0,0,0, 0.024,0.12,0.02, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(-0.048,-0.33,0.15); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #4"; }
  { const q=new Q(); q.box(0,0,0, 0.024,0.12,0.02, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0.048,-0.33,0.15); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #5"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.042,0.018, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.4,0.152); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #6"; }
  { const q=new Q(); q.box(0,0,0, 0.28,0.114,0.4, 0xd0e13, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.738,0.055); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #7"; }
  { const q=new Q(); q.box(0,0,0, 0.3,0.052,0.42, 0xf5f4f5, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.817,0.058); m.rotation.set(0,0,0); m.name="高筒靴 R（三角靴翼） #8"; }
  // ---- 胸腔 (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.44,0.2,0.28, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.92,0.01); m.rotation.set(0,0,0); m.name="胸腔 #1"; }
  // ---- 腰腹（露腹） (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.34,0.21,0.25, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.715,0.01); m.rotation.set(0,0,0); m.name="腰腹（露腹） #1"; }
  // ---- 骨盆 (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.44,0.24,0.3, 0xf4e4dc, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.44,0.01); m.rotation.set(0,0,0); m.name="骨盆 #1"; }
  attachFace(head, { id:"lappland", iris:[0x566967,0x8faaa3,0xc2d2c8] });
  return { root, body, head, arms:[armL,armR], legs:[legL,legR], coatTails, tail };
}