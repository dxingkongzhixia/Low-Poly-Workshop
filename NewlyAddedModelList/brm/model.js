/* ============================================================
   由「低模部件编辑器」导出 —— 黑双马尾（参照图重建） (brm)
   依赖 characters.orig.js 的 Q / XT；用法：const c = build_brm(); scene.add(c.root);
   ============================================================ */
function build_brm(){
  const C = { hair:0x24252b, hairHi:0x30323a, coat:0x1e1f24, coatHi:0x2a2c33, trim:0xf2f3f5, skin:0xf7d9c4, under:0x17181c, metal:0xc9ccd2 };
  const Ft = [1.672, 1.54, 1.518];
  const X = THREE.Group;
  const root=new X(), body=new X(), head=new X(),
        armL=new X(), armR=new X(), legL=new X(), legR=new X(), coatTails=new X(), tail=new X();
  root.add(body); body.add(head); body.add(coatTails); body.add(tail); body.add(armL,armR,legL,legR);
  const P={body,head,armL,armR,legL,legR,coatTails,tail};
  const RG={"body":{"p":[0,-0.1095,0],"r":[0,0,0],"s":[1,1,1]},"head":{"p":[0,1.47,0],"r":[0,0,0],"s":[1.672,1.54,1.518]},"armL":{"p":[-0.36,1.2183,0],"r":[0,0,0],"s":[1,1,1]},"armR":{"p":[0.36,1.2183,0],"r":[0,0,0],"s":[1,1,1]},"legL":{"p":[-0.16,0.73,0],"r":[0,0,0],"s":[1,0.85,1]},"legR":{"p":[0.16,0.73,0],"r":[0,0,0],"s":[1,0.85,1]},"coatTails":{"p":[0,1.05,-0.1],"r":[0,0,0],"s":[1,1,1]},"tail":{"p":[0,0.77,-0.23],"r":[0,0,0],"s":[1,1,1]},"root":{"p":[0,0,0],"r":[0,0,0],"s":[1.008,1.008,1.008]}};
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
  // ---- 脖子 (脖子) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.18,0.2, C.skin, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.45,0.03); m.rotation.set(0,0,0); m.name="脖子 #1"; }
  // ---- 躯干（露腹） (基础身体) ----
  { const q=new Q(); q.box(0,0,0, 0.3,0.3,0.25, C.skin, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.2,0.04); m.rotation.set(0,0,0); m.name="躯干（露腹） #1"; }
  { const q=new Q(); q.box(0,0,0, 0.28,0.24,0.23, C.skin, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.95,0.05); m.rotation.set(0,0,0); m.name="躯干（露腹） #2"; }
  // ---- 大腿 (基础腿部) ----
  { const q=new Q(); q.box(0,0,0, 0.175,0.34,0.185, C.skin, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.13,0); m.rotation.set(0,0,0); m.name="大腿 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.1,0.16, C.skin, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.3,0.01); m.rotation.set(0,0,0); m.name="大腿 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.175,0.34,0.185, C.skin, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.13,0); m.rotation.set(0,0,0); m.name="大腿 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.1,0.16, C.skin, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.3,0.01); m.rotation.set(0,0,0); m.name="大腿 #4"; }
  // ---- 大腿 (镜像) (基础腿部) ----
  { const q=new Q(); q.box(0,0,0, 0.175,0.34,0.185, C.skin, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.13,0); m.rotation.set(0,0,0); m.name="大腿 (镜像) #1"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.1,0.16, C.skin, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.3,0.01); m.rotation.set(0,0,0); m.name="大腿 (镜像) #2"; }
  { const q=new Q(); q.box(0,0,0, 0.175,0.34,0.185, C.skin, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.13,0); m.rotation.set(0,0,0); m.name="大腿 (镜像) #3"; }
  { const q=new Q(); q.box(0,0,0, 0.15,0.1,0.16, C.skin, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.3,0.01); m.rotation.set(0,0,0); m.name="大腿 (镜像) #4"; }
  // ---- 腿环 (腿部装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.175,0.065,0.185, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0.01,-0.14,0); m.rotation.set(0,0,0); m.name="腿环 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.032,0.12,0.032, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0.095,-0.185,0.02); m.rotation.set(0,0,0); m.name="腿环 #2"; }
  // ---- 双马尾 R (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.168,0.18144000000000002,0.168, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.3,0.47,-0.048); m.rotation.set(0,0,0); m.name="双马尾 R #1"; }
  { const q=new Q(); q.box(0,0,0, 0.152,0.16416,0.152, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.266,0.37,-0.038); m.rotation.set(0,0,0); m.name="双马尾 R #2"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.238,0.556,-0.064); m.rotation.set(0,0,0); m.name="双马尾 R #3"; }
  { const q=new Q(); q.box(0,0,0, 0.146,0.15768,0.146, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.33,0.352,-0.03); m.rotation.set(0,0,0); m.name="双马尾 R #4"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.15120000000000003,0.14, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.356,0.264,-0.027); m.rotation.set(0,0,0); m.name="双马尾 R #5"; }
  { const q=new Q(); q.box(0,0,0, 0.134,0.14472000000000002,0.134, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.376,0.176,-0.024); m.rotation.set(0,0,0); m.name="双马尾 R #6"; }
  { const q=new Q(); q.box(0,0,0, 0.128,0.13824,0.128, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.39,0.088,-0.021); m.rotation.set(0,0,0); m.name="双马尾 R #7"; }
  { const q=new Q(); q.box(0,0,0, 0.124,0.13392,0.124, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.399,0,-0.018); m.rotation.set(0,0,0); m.name="双马尾 R #8"; }
  { const q=new Q(); q.box(0,0,0, 0.12,0.1296,0.12, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.404,-0.088,-0.015); m.rotation.set(0,0,0); m.name="双马尾 R #9"; }
  { const q=new Q(); q.box(0,0,0, 0.116,0.12528,0.116, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.405,-0.176,-0.012); m.rotation.set(0,0,0); m.name="双马尾 R #10"; }
  { const q=new Q(); q.box(0,0,0, 0.112,0.12096000000000001,0.112, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.402,-0.264,-0.009); m.rotation.set(0,0,0); m.name="双马尾 R #11"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.397,-0.352,-0.006); m.rotation.set(0,0,0); m.name="双马尾 R #12"; }
  { const q=new Q(); q.box(0,0,0, 0.104,0.11232,0.104, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.392,-0.44,-0.003); m.rotation.set(0,0,0); m.name="双马尾 R #13"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.10800000000000001,0.1, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.388,-0.528,0); m.rotation.set(0,0,0); m.name="双马尾 R #14"; }
  { const q=new Q(); q.box(0,0,0, 0.095,0.10260000000000001,0.095, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.385,-0.616,0.003); m.rotation.set(0,0,0); m.name="双马尾 R #15"; }
  { const q=new Q(); q.box(0,0,0, 0.07,0.07560000000000001,0.07, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.383,-0.688,0.006); m.rotation.set(0,0,0); m.name="双马尾 R #16"; }
  { const q=new Q(); q.box(0,0,0, 0.138,0.14904000000000003,0.138, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.262,0.372,-0.104); m.rotation.set(0,0,0); m.name="双马尾 R #17"; }
  { const q=new Q(); q.box(0,0,0, 0.132,0.14256000000000002,0.132, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.28,0.286,-0.1); m.rotation.set(0,0,0); m.name="双马尾 R #18"; }
  { const q=new Q(); q.box(0,0,0, 0.126,0.13608,0.126, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.296,0.2,-0.096); m.rotation.set(0,0,0); m.name="双马尾 R #19"; }
  { const q=new Q(); q.box(0,0,0, 0.121,0.13068000000000002,0.121, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.307,0.114,-0.092); m.rotation.set(0,0,0); m.name="双马尾 R #20"; }
  { const q=new Q(); q.box(0,0,0, 0.117,0.12636000000000003,0.117, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.314,0.028,-0.088); m.rotation.set(0,0,0); m.name="双马尾 R #21"; }
  { const q=new Q(); q.box(0,0,0, 0.113,0.12204000000000001,0.113, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.318,-0.058,-0.084); m.rotation.set(0,0,0); m.name="双马尾 R #22"; }
  { const q=new Q(); q.box(0,0,0, 0.109,0.11772,0.109, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.319,-0.144,-0.08); m.rotation.set(0,0,0); m.name="双马尾 R #23"; }
  { const q=new Q(); q.box(0,0,0, 0.105,0.1134,0.105, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.317,-0.23,-0.076); m.rotation.set(0,0,0); m.name="双马尾 R #24"; }
  { const q=new Q(); q.box(0,0,0, 0.101,0.10908000000000001,0.101, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.313,-0.316,-0.072); m.rotation.set(0,0,0); m.name="双马尾 R #25"; }
  { const q=new Q(); q.box(0,0,0, 0.097,0.10476,0.097, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.309,-0.4,-0.068); m.rotation.set(0,0,0); m.name="双马尾 R #26"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.054000000000000006,0.05, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.312,0.412,-0.052); m.rotation.set(0,0,0); m.name="双马尾 R #27"; }
  { const q=new Q(); q.box(0,0,0, 0.049,0.05292000000000001,0.049, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.353,0.379,-0.051); m.rotation.set(0,0,0); m.name="双马尾 R #28"; }
  { const q=new Q(); q.box(0,0,0, 0.048,0.051840000000000004,0.048, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.394,0.346,-0.049); m.rotation.set(0,0,0); m.name="双马尾 R #29"; }
  { const q=new Q(); q.box(0,0,0, 0.047,0.050760000000000007,0.047, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.435,0.313,-0.048); m.rotation.set(0,0,0); m.name="双马尾 R #30"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.04968,0.046, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.476,0.28,-0.046); m.rotation.set(0,0,0); m.name="双马尾 R #31"; }
  { const q=new Q(); q.box(0,0,0, 0.045,0.048600000000000004,0.045, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.517,0.247,-0.045); m.rotation.set(0,0,0); m.name="双马尾 R #32"; }
  { const q=new Q(); q.box(0,0,0, 0.044,0.04752,0.044, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.558,0.214,-0.043); m.rotation.set(0,0,0); m.name="双马尾 R #33"; }
  { const q=new Q(); q.box(0,0,0, 0.043,0.04644,0.043, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.599,0.181,-0.042); m.rotation.set(0,0,0); m.name="双马尾 R #34"; }
  { const q=new Q(); q.box(0,0,0, 0.042,0.045360000000000004,0.042, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.638,0.148,-0.04); m.rotation.set(0,0,0); m.name="双马尾 R #35"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.18144000000000002,0.168, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.3,0.47,-0.048); m.rotation.set(0,0,0); m.name="双马尾 R #36"; }
  { const q=new Q(); q.box(0,0,0, 0.152,0.16416,0.152, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.266,0.37,-0.038); m.rotation.set(0,0,0); m.name="双马尾 R #37"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.238,0.556,-0.064); m.rotation.set(0,0,0); m.name="双马尾 R #38"; }
  { const q=new Q(); q.box(0,0,0, 0.146,0.15768,0.146, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.33,0.352,-0.03); m.rotation.set(0,0,0); m.name="双马尾 R #39"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.15120000000000003,0.14, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.356,0.264,-0.027); m.rotation.set(0,0,0); m.name="双马尾 R #40"; }
  { const q=new Q(); q.box(0,0,0, 0.134,0.14472000000000002,0.134, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.376,0.176,-0.024); m.rotation.set(0,0,0); m.name="双马尾 R #41"; }
  { const q=new Q(); q.box(0,0,0, 0.128,0.13824,0.128, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.39,0.088,-0.021); m.rotation.set(0,0,0); m.name="双马尾 R #42"; }
  { const q=new Q(); q.box(0,0,0, 0.124,0.13392,0.124, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.399,0,-0.018); m.rotation.set(0,0,0); m.name="双马尾 R #43"; }
  { const q=new Q(); q.box(0,0,0, 0.12,0.1296,0.12, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.404,-0.088,-0.015); m.rotation.set(0,0,0); m.name="双马尾 R #44"; }
  { const q=new Q(); q.box(0,0,0, 0.116,0.12528,0.116, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.405,-0.176,-0.012); m.rotation.set(0,0,0); m.name="双马尾 R #45"; }
  { const q=new Q(); q.box(0,0,0, 0.112,0.12096000000000001,0.112, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.402,-0.264,-0.009); m.rotation.set(0,0,0); m.name="双马尾 R #46"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.397,-0.352,-0.006); m.rotation.set(0,0,0); m.name="双马尾 R #47"; }
  { const q=new Q(); q.box(0,0,0, 0.104,0.11232,0.104, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.392,-0.44,-0.003); m.rotation.set(0,0,0); m.name="双马尾 R #48"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.10800000000000001,0.1, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.388,-0.528,0); m.rotation.set(0,0,0); m.name="双马尾 R #49"; }
  { const q=new Q(); q.box(0,0,0, 0.095,0.10260000000000001,0.095, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.385,-0.616,0.003); m.rotation.set(0,0,0); m.name="双马尾 R #50"; }
  { const q=new Q(); q.box(0,0,0, 0.07,0.07560000000000001,0.07, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.383,-0.688,0.006); m.rotation.set(0,0,0); m.name="双马尾 R #51"; }
  { const q=new Q(); q.box(0,0,0, 0.138,0.14904000000000003,0.138, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.262,0.372,-0.104); m.rotation.set(0,0,0); m.name="双马尾 R #52"; }
  { const q=new Q(); q.box(0,0,0, 0.132,0.14256000000000002,0.132, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.28,0.286,-0.1); m.rotation.set(0,0,0); m.name="双马尾 R #53"; }
  { const q=new Q(); q.box(0,0,0, 0.126,0.13608,0.126, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.296,0.2,-0.096); m.rotation.set(0,0,0); m.name="双马尾 R #54"; }
  { const q=new Q(); q.box(0,0,0, 0.121,0.13068000000000002,0.121, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.307,0.114,-0.092); m.rotation.set(0,0,0); m.name="双马尾 R #55"; }
  { const q=new Q(); q.box(0,0,0, 0.117,0.12636000000000003,0.117, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.314,0.028,-0.088); m.rotation.set(0,0,0); m.name="双马尾 R #56"; }
  { const q=new Q(); q.box(0,0,0, 0.113,0.12204000000000001,0.113, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.318,-0.058,-0.084); m.rotation.set(0,0,0); m.name="双马尾 R #57"; }
  { const q=new Q(); q.box(0,0,0, 0.109,0.11772,0.109, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.319,-0.144,-0.08); m.rotation.set(0,0,0); m.name="双马尾 R #58"; }
  { const q=new Q(); q.box(0,0,0, 0.105,0.1134,0.105, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.317,-0.23,-0.076); m.rotation.set(0,0,0); m.name="双马尾 R #59"; }
  { const q=new Q(); q.box(0,0,0, 0.101,0.10908000000000001,0.101, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.313,-0.316,-0.072); m.rotation.set(0,0,0); m.name="双马尾 R #60"; }
  { const q=new Q(); q.box(0,0,0, 0.097,0.10476,0.097, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.309,-0.4,-0.068); m.rotation.set(0,0,0); m.name="双马尾 R #61"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.054000000000000006,0.05, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.312,0.412,-0.052); m.rotation.set(0,0,0); m.name="双马尾 R #62"; }
  { const q=new Q(); q.box(0,0,0, 0.049,0.05292000000000001,0.049, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.353,0.379,-0.051); m.rotation.set(0,0,0); m.name="双马尾 R #63"; }
  { const q=new Q(); q.box(0,0,0, 0.048,0.051840000000000004,0.048, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.394,0.346,-0.049); m.rotation.set(0,0,0); m.name="双马尾 R #64"; }
  { const q=new Q(); q.box(0,0,0, 0.047,0.050760000000000007,0.047, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.435,0.313,-0.048); m.rotation.set(0,0,0); m.name="双马尾 R #65"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.04968,0.046, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.476,0.28,-0.046); m.rotation.set(0,0,0); m.name="双马尾 R #66"; }
  { const q=new Q(); q.box(0,0,0, 0.045,0.048600000000000004,0.045, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.517,0.247,-0.045); m.rotation.set(0,0,0); m.name="双马尾 R #67"; }
  { const q=new Q(); q.box(0,0,0, 0.044,0.04752,0.044, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.558,0.214,-0.043); m.rotation.set(0,0,0); m.name="双马尾 R #68"; }
  { const q=new Q(); q.box(0,0,0, 0.043,0.04644,0.043, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.599,0.181,-0.042); m.rotation.set(0,0,0); m.name="双马尾 R #69"; }
  { const q=new Q(); q.box(0,0,0, 0.042,0.045360000000000004,0.042, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(0.638,0.148,-0.04); m.rotation.set(0,0,0); m.name="双马尾 R #70"; }
  // ---- 双马尾 L (头发) ----
  { const q=new Q(); q.box(0,0,0, 0.168,0.18144000000000002,0.168, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.3,0.47,-0.048); m.rotation.set(0,0,0); m.name="双马尾 L #1"; }
  { const q=new Q(); q.box(0,0,0, 0.152,0.16416,0.152, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.266,0.37,-0.038); m.rotation.set(0,0,0); m.name="双马尾 L #2"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.238,0.556,-0.064); m.rotation.set(0,0,0); m.name="双马尾 L #3"; }
  { const q=new Q(); q.box(0,0,0, 0.146,0.15768,0.146, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.33,0.352,-0.03); m.rotation.set(0,0,0); m.name="双马尾 L #4"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.15120000000000003,0.14, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.356,0.264,-0.027); m.rotation.set(0,0,0); m.name="双马尾 L #5"; }
  { const q=new Q(); q.box(0,0,0, 0.134,0.14472000000000002,0.134, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.376,0.176,-0.024); m.rotation.set(0,0,0); m.name="双马尾 L #6"; }
  { const q=new Q(); q.box(0,0,0, 0.128,0.13824,0.128, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.39,0.088,-0.021); m.rotation.set(0,0,0); m.name="双马尾 L #7"; }
  { const q=new Q(); q.box(0,0,0, 0.124,0.13392,0.124, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.399,0,-0.018); m.rotation.set(0,0,0); m.name="双马尾 L #8"; }
  { const q=new Q(); q.box(0,0,0, 0.12,0.1296,0.12, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.404,-0.088,-0.015); m.rotation.set(0,0,0); m.name="双马尾 L #9"; }
  { const q=new Q(); q.box(0,0,0, 0.116,0.12528,0.116, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.405,-0.176,-0.012); m.rotation.set(0,0,0); m.name="双马尾 L #10"; }
  { const q=new Q(); q.box(0,0,0, 0.112,0.12096000000000001,0.112, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.402,-0.264,-0.009); m.rotation.set(0,0,0); m.name="双马尾 L #11"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.397,-0.352,-0.006); m.rotation.set(0,0,0); m.name="双马尾 L #12"; }
  { const q=new Q(); q.box(0,0,0, 0.104,0.11232,0.104, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.392,-0.44,-0.003); m.rotation.set(0,0,0); m.name="双马尾 L #13"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.10800000000000001,0.1, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.388,-0.528,0); m.rotation.set(0,0,0); m.name="双马尾 L #14"; }
  { const q=new Q(); q.box(0,0,0, 0.095,0.10260000000000001,0.095, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.385,-0.616,0.003); m.rotation.set(0,0,0); m.name="双马尾 L #15"; }
  { const q=new Q(); q.box(0,0,0, 0.07,0.07560000000000001,0.07, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.383,-0.688,0.006); m.rotation.set(0,0,0); m.name="双马尾 L #16"; }
  { const q=new Q(); q.box(0,0,0, 0.138,0.14904000000000003,0.138, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.262,0.372,-0.104); m.rotation.set(0,0,0); m.name="双马尾 L #17"; }
  { const q=new Q(); q.box(0,0,0, 0.132,0.14256000000000002,0.132, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.28,0.286,-0.1); m.rotation.set(0,0,0); m.name="双马尾 L #18"; }
  { const q=new Q(); q.box(0,0,0, 0.126,0.13608,0.126, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.296,0.2,-0.096); m.rotation.set(0,0,0); m.name="双马尾 L #19"; }
  { const q=new Q(); q.box(0,0,0, 0.121,0.13068000000000002,0.121, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.307,0.114,-0.092); m.rotation.set(0,0,0); m.name="双马尾 L #20"; }
  { const q=new Q(); q.box(0,0,0, 0.117,0.12636000000000003,0.117, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.314,0.028,-0.088); m.rotation.set(0,0,0); m.name="双马尾 L #21"; }
  { const q=new Q(); q.box(0,0,0, 0.113,0.12204000000000001,0.113, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.318,-0.058,-0.084); m.rotation.set(0,0,0); m.name="双马尾 L #22"; }
  { const q=new Q(); q.box(0,0,0, 0.109,0.11772,0.109, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.319,-0.144,-0.08); m.rotation.set(0,0,0); m.name="双马尾 L #23"; }
  { const q=new Q(); q.box(0,0,0, 0.105,0.1134,0.105, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.317,-0.23,-0.076); m.rotation.set(0,0,0); m.name="双马尾 L #24"; }
  { const q=new Q(); q.box(0,0,0, 0.101,0.10908000000000001,0.101, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.313,-0.316,-0.072); m.rotation.set(0,0,0); m.name="双马尾 L #25"; }
  { const q=new Q(); q.box(0,0,0, 0.097,0.10476,0.097, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.309,-0.4,-0.068); m.rotation.set(0,0,0); m.name="双马尾 L #26"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.054000000000000006,0.05, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.312,0.412,-0.052); m.rotation.set(0,0,0); m.name="双马尾 L #27"; }
  { const q=new Q(); q.box(0,0,0, 0.049,0.05292000000000001,0.049, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.353,0.379,-0.051); m.rotation.set(0,0,0); m.name="双马尾 L #28"; }
  { const q=new Q(); q.box(0,0,0, 0.048,0.051840000000000004,0.048, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.394,0.346,-0.049); m.rotation.set(0,0,0); m.name="双马尾 L #29"; }
  { const q=new Q(); q.box(0,0,0, 0.047,0.050760000000000007,0.047, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.435,0.313,-0.048); m.rotation.set(0,0,0); m.name="双马尾 L #30"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.04968,0.046, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.476,0.28,-0.046); m.rotation.set(0,0,0); m.name="双马尾 L #31"; }
  { const q=new Q(); q.box(0,0,0, 0.045,0.048600000000000004,0.045, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.517,0.247,-0.045); m.rotation.set(0,0,0); m.name="双马尾 L #32"; }
  { const q=new Q(); q.box(0,0,0, 0.044,0.04752,0.044, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.558,0.214,-0.043); m.rotation.set(0,0,0); m.name="双马尾 L #33"; }
  { const q=new Q(); q.box(0,0,0, 0.043,0.04644,0.043, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.599,0.181,-0.042); m.rotation.set(0,0,0); m.name="双马尾 L #34"; }
  { const q=new Q(); q.box(0,0,0, 0.042,0.045360000000000004,0.042, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.638,0.148,-0.04); m.rotation.set(0,0,0); m.name="双马尾 L #35"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.18144000000000002,0.168, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.3,0.47,-0.048); m.rotation.set(0,0,0); m.name="双马尾 L #36"; }
  { const q=new Q(); q.box(0,0,0, 0.152,0.16416,0.152, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.266,0.37,-0.038); m.rotation.set(0,0,0); m.name="双马尾 L #37"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.238,0.556,-0.064); m.rotation.set(0,0,0); m.name="双马尾 L #38"; }
  { const q=new Q(); q.box(0,0,0, 0.146,0.15768,0.146, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.33,0.352,-0.03); m.rotation.set(0,0,0); m.name="双马尾 L #39"; }
  { const q=new Q(); q.box(0,0,0, 0.14,0.15120000000000003,0.14, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.356,0.264,-0.027); m.rotation.set(0,0,0); m.name="双马尾 L #40"; }
  { const q=new Q(); q.box(0,0,0, 0.134,0.14472000000000002,0.134, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.376,0.176,-0.024); m.rotation.set(0,0,0); m.name="双马尾 L #41"; }
  { const q=new Q(); q.box(0,0,0, 0.128,0.13824,0.128, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.39,0.088,-0.021); m.rotation.set(0,0,0); m.name="双马尾 L #42"; }
  { const q=new Q(); q.box(0,0,0, 0.124,0.13392,0.124, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.399,0,-0.018); m.rotation.set(0,0,0); m.name="双马尾 L #43"; }
  { const q=new Q(); q.box(0,0,0, 0.12,0.1296,0.12, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.404,-0.088,-0.015); m.rotation.set(0,0,0); m.name="双马尾 L #44"; }
  { const q=new Q(); q.box(0,0,0, 0.116,0.12528,0.116, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.405,-0.176,-0.012); m.rotation.set(0,0,0); m.name="双马尾 L #45"; }
  { const q=new Q(); q.box(0,0,0, 0.112,0.12096000000000001,0.112, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.402,-0.264,-0.009); m.rotation.set(0,0,0); m.name="双马尾 L #46"; }
  { const q=new Q(); q.box(0,0,0, 0.108,0.11664000000000001,0.108, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.397,-0.352,-0.006); m.rotation.set(0,0,0); m.name="双马尾 L #47"; }
  { const q=new Q(); q.box(0,0,0, 0.104,0.11232,0.104, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.392,-0.44,-0.003); m.rotation.set(0,0,0); m.name="双马尾 L #48"; }
  { const q=new Q(); q.box(0,0,0, 0.1,0.10800000000000001,0.1, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.388,-0.528,0); m.rotation.set(0,0,0); m.name="双马尾 L #49"; }
  { const q=new Q(); q.box(0,0,0, 0.095,0.10260000000000001,0.095, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.385,-0.616,0.003); m.rotation.set(0,0,0); m.name="双马尾 L #50"; }
  { const q=new Q(); q.box(0,0,0, 0.07,0.07560000000000001,0.07, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.383,-0.688,0.006); m.rotation.set(0,0,0); m.name="双马尾 L #51"; }
  { const q=new Q(); q.box(0,0,0, 0.138,0.14904000000000003,0.138, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.262,0.372,-0.104); m.rotation.set(0,0,0); m.name="双马尾 L #52"; }
  { const q=new Q(); q.box(0,0,0, 0.132,0.14256000000000002,0.132, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.28,0.286,-0.1); m.rotation.set(0,0,0); m.name="双马尾 L #53"; }
  { const q=new Q(); q.box(0,0,0, 0.126,0.13608,0.126, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.296,0.2,-0.096); m.rotation.set(0,0,0); m.name="双马尾 L #54"; }
  { const q=new Q(); q.box(0,0,0, 0.121,0.13068000000000002,0.121, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.307,0.114,-0.092); m.rotation.set(0,0,0); m.name="双马尾 L #55"; }
  { const q=new Q(); q.box(0,0,0, 0.117,0.12636000000000003,0.117, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.314,0.028,-0.088); m.rotation.set(0,0,0); m.name="双马尾 L #56"; }
  { const q=new Q(); q.box(0,0,0, 0.113,0.12204000000000001,0.113, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.318,-0.058,-0.084); m.rotation.set(0,0,0); m.name="双马尾 L #57"; }
  { const q=new Q(); q.box(0,0,0, 0.109,0.11772,0.109, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.319,-0.144,-0.08); m.rotation.set(0,0,0); m.name="双马尾 L #58"; }
  { const q=new Q(); q.box(0,0,0, 0.105,0.1134,0.105, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.317,-0.23,-0.076); m.rotation.set(0,0,0); m.name="双马尾 L #59"; }
  { const q=new Q(); q.box(0,0,0, 0.101,0.10908000000000001,0.101, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.313,-0.316,-0.072); m.rotation.set(0,0,0); m.name="双马尾 L #60"; }
  { const q=new Q(); q.box(0,0,0, 0.097,0.10476,0.097, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.309,-0.4,-0.068); m.rotation.set(0,0,0); m.name="双马尾 L #61"; }
  { const q=new Q(); q.box(0,0,0, 0.05,0.054000000000000006,0.05, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.312,0.412,-0.052); m.rotation.set(0,0,0); m.name="双马尾 L #62"; }
  { const q=new Q(); q.box(0,0,0, 0.049,0.05292000000000001,0.049, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.353,0.379,-0.051); m.rotation.set(0,0,0); m.name="双马尾 L #63"; }
  { const q=new Q(); q.box(0,0,0, 0.048,0.051840000000000004,0.048, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.394,0.346,-0.049); m.rotation.set(0,0,0); m.name="双马尾 L #64"; }
  { const q=new Q(); q.box(0,0,0, 0.047,0.050760000000000007,0.047, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.435,0.313,-0.048); m.rotation.set(0,0,0); m.name="双马尾 L #65"; }
  { const q=new Q(); q.box(0,0,0, 0.046,0.04968,0.046, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.476,0.28,-0.046); m.rotation.set(0,0,0); m.name="双马尾 L #66"; }
  { const q=new Q(); q.box(0,0,0, 0.045,0.048600000000000004,0.045, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.517,0.247,-0.045); m.rotation.set(0,0,0); m.name="双马尾 L #67"; }
  { const q=new Q(); q.box(0,0,0, 0.044,0.04752,0.044, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.558,0.214,-0.043); m.rotation.set(0,0,0); m.name="双马尾 L #68"; }
  { const q=new Q(); q.box(0,0,0, 0.043,0.04644,0.043, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.599,0.181,-0.042); m.rotation.set(0,0,0); m.name="双马尾 L #69"; }
  { const q=new Q(); q.box(0,0,0, 0.042,0.045360000000000004,0.042, C.hair, 0);
    const m=q.build(P.head, 0.05);
    m.position.set(-0.638,0.148,-0.04); m.rotation.set(0,0,0); m.name="双马尾 L #70"; }
  // ---- 内搭 (身体装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.33,0.175,0.115, C.under, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.265,0.125); m.rotation.set(0,0,0); m.name="内搭 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.078,0.055,0.028, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.038,1.34,0.188); m.rotation.set(0,0,0.5); m.name="内搭 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.078,0.055,0.028, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.038,1.34,0.188); m.rotation.set(0,0,-0.5); m.name="内搭 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.034,0.034,0.026, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.33,0.192); m.rotation.set(0,0,0); m.name="内搭 #4"; }
  // ---- 外套上身 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.62,0.15,0.36, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.425,-0.02); m.rotation.set(0,0,0); m.name="外套上身 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.31,0.12,0.13, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.515,-0.13); m.rotation.set(0,0,0); m.name="外套上身 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.46,0.62,0.11, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.135,-0.155); m.rotation.set(0,0,0); m.name="外套上身 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.155,0.64,0.225, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.225,1.13,0.055); m.rotation.set(0,0,0); m.name="外套上身 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.155,0.64,0.225, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.225,1.13,0.055); m.rotation.set(0,0,0); m.name="外套上身 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.175,0.1,0.215, C.coatHi, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.225,1.445,0.115); m.rotation.set(0,0,0); m.name="外套上身 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.175,0.1,0.215, C.coatHi, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.225,1.445,0.115); m.rotation.set(0,0,0); m.name="外套上身 #7"; }
  { const q=new Q(); q.box(0,0,0, 0.03,0.62,0.035, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.15,1.13,0.158); m.rotation.set(0,0,0); m.name="外套上身 #8"; }
  { const q=new Q(); q.box(0,0,0, 0.03,0.62,0.035, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.15,1.13,0.158); m.rotation.set(0,0,0); m.name="外套上身 #9"; }
  { const q=new Q(); q.box(0,0,0, 0.145,0.048,0.245, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.238,0.795,0.075); m.rotation.set(0,0,0); m.name="外套上身 #10"; }
  { const q=new Q(); q.box(0,0,0, 0.145,0.048,0.245, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.238,0.795,0.075); m.rotation.set(0,0,0); m.name="外套上身 #11"; }
  { const q=new Q(); q.box(0,0,0, 0.3,0.028,0.24, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.19,0.075); m.rotation.set(0,0,0); m.name="外套上身 #12"; }
  // ---- 外套后摆 (服装装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.135,0.44,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.37,-0.28,-0.045); m.rotation.set(0,0,-0.1); m.name="外套后摆 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.515,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.2466666666666667,-0.3175,-0.045); m.rotation.set(0,0,-0.06666666666666668); m.name="外套后摆 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.5699038105676658,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.12333333333333335,-0.3449519052838329,-0.045); m.rotation.set(0,0,-0.03333333333333334); m.name="外套后摆 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.59,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0,-0.355,-0.045); m.rotation.set(0,0,0); m.name="外套后摆 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.5699038105676658,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.12333333333333331,-0.3449519052838329,-0.045); m.rotation.set(0,0,0.033333333333333326); m.name="外套后摆 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.515,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.2466666666666667,-0.3175,-0.045); m.rotation.set(0,0,0.06666666666666668); m.name="外套后摆 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.135,0.44,0.26, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.37,-0.28,-0.045); m.rotation.set(0,0,0.1); m.name="外套后摆 #7"; }
  { const q=new Q(); q.box(0,0,0, 0.115,0.42,0.2, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(-0.285,-0.185,0.095); m.rotation.set(0,0,-0.15); m.name="外套后摆 #8"; }
  { const q=new Q(); q.box(0,0,0, 0.115,0.42,0.2, C.coat, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0.285,-0.185,0.095); m.rotation.set(0,0,0.15); m.name="外套后摆 #9"; }
  { const q=new Q(); q.box(0,0,0, 0.68,0.065,0.26, C.trim, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0,-0.495,-0.045); m.rotation.set(0,0,0); m.name="外套后摆 #10"; }
  { const q=new Q(); q.box(0,0,0, 0.7,0.03,0.03, C.trim, 0);
    const m=q.build(P.coatTails, 0.05);
    m.position.set(0,0.005,-0.175); m.rotation.set(0,0,0); m.name="外套后摆 #11"; }
  // ---- 短裤 (身体装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.415,0.27,0.32, C.under, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.735,0); m.rotation.set(0,0,0); m.name="短裤 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.408,0.042,0.314, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.858,0); m.rotation.set(0,0,0); m.name="短裤 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.402,0.028,0.308, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,0.808,0); m.rotation.set(0,0,0); m.name="短裤 #3"; }
  // ---- 袖子+手套 (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.18,0.3,0.195, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.125,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.165,0.26,0.18, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.355,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.172,0.048,0.188, C.trim, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.47,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.155,0.178, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.56,0.03); m.rotation.set(0,0,0); m.name="袖子+手套 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.18,0.3,0.195, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.125,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.165,0.26,0.18, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.355,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.172,0.048,0.188, C.trim, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.47,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 #7"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.155,0.178, C.coat, 0);
    const m=q.build(P.armL, 0.05);
    m.position.set(0,-0.56,0.03); m.rotation.set(0,0,0); m.name="袖子+手套 #8"; }
  // ---- 袖子+手套 (镜像) (手臂装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.18,0.3,0.195, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.125,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #1"; }
  { const q=new Q(); q.box(0,0,0, 0.165,0.26,0.18, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.355,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #2"; }
  { const q=new Q(); q.box(0,0,0, 0.172,0.048,0.188, C.trim, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.47,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #3"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.155,0.178, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.56,0.03); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #4"; }
  { const q=new Q(); q.box(0,0,0, 0.18,0.3,0.195, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.125,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #5"; }
  { const q=new Q(); q.box(0,0,0, 0.165,0.26,0.18, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.355,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #6"; }
  { const q=new Q(); q.box(0,0,0, 0.172,0.048,0.188, C.trim, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.47,0.02); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #7"; }
  { const q=new Q(); q.box(0,0,0, 0.168,0.155,0.178, C.coat, 0);
    const m=q.build(P.armR, 0.05);
    m.position.set(0,-0.56,0.03); m.rotation.set(0,0,0); m.name="袖子+手套 (镜像) #8"; }
  // ---- 靴子 (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.225, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.495,0); m.rotation.set(0,0,0); m.name="靴子 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.145,0.3, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.66,0.05); m.rotation.set(0,0,0); m.name="靴子 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.21,0.048,0.235, C.trim, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.445,0.01); m.rotation.set(0,0,0); m.name="靴子 #3"; }
  { const q=new Q(); q.shape([[-0.075,0.0467],[0.075,0.0467],[0,-0.0933]], 0, 0.02, C.trim);
    const m=q.build(P.legL, 0.05); m.position.set(0,-0.46166666666666667,0.125); m.name="靴子 #4"; }
  { const q=new Q(); q.box(0,0,0, 0.205,0.03,0.305, C.trim, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.722,0.05); m.rotation.set(0,0,0); m.name="靴子 #5"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.225, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.495,0); m.rotation.set(0,0,0); m.name="靴子 #6"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.145,0.3, C.coat, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.66,0.05); m.rotation.set(0,0,0); m.name="靴子 #7"; }
  { const q=new Q(); q.box(0,0,0, 0.21,0.048,0.235, C.trim, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.445,0.01); m.rotation.set(0,0,0); m.name="靴子 #8"; }
  { const q=new Q(); q.shape([[0,-0.0933],[-0.075,0.0467],[0.075,0.0467]], 0, 0.02, C.trim);
    const m=q.build(P.legL, 0.05); m.position.set(0,-0.46166666666666667,0.125); m.name="靴子 #9"; }
  { const q=new Q(); q.box(0,0,0, 0.205,0.03,0.305, C.trim, 0);
    const m=q.build(P.legL, 0.05);
    m.position.set(0,-0.722,0.05); m.rotation.set(0,0,0); m.name="靴子 #10"; }
  // ---- 靴子 (镜像) (鞋子) ----
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.225, C.coat, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.495,0); m.rotation.set(0,0,0); m.name="靴子 (镜像) #1"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.145,0.3, C.coat, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.66,0.05); m.rotation.set(0,0,0); m.name="靴子 (镜像) #2"; }
  { const q=new Q(); q.box(0,0,0, 0.21,0.048,0.235, C.trim, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.445,0.01); m.rotation.set(0,0,0); m.name="靴子 (镜像) #3"; }
  { const q=new Q(); q.shape([[0,-0.0933],[-0.075,0.0467],[0.075,0.0467]], 0, 0.02, C.trim);
    const m=q.build(P.legR, 0.05); m.position.set(0,-0.46166666666666667,0.125); m.name="靴子 (镜像) #4"; }
  { const q=new Q(); q.box(0,0,0, 0.205,0.03,0.305, C.trim, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.722,0.05); m.rotation.set(0,0,0); m.name="靴子 (镜像) #5"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.3,0.225, C.coat, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.495,0); m.rotation.set(0,0,0); m.name="靴子 (镜像) #6"; }
  { const q=new Q(); q.box(0,0,0, 0.2,0.145,0.3, C.coat, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.66,0.05); m.rotation.set(0,0,0); m.name="靴子 (镜像) #7"; }
  { const q=new Q(); q.box(0,0,0, 0.21,0.048,0.235, C.trim, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.445,0.01); m.rotation.set(0,0,0); m.name="靴子 (镜像) #8"; }
  { const q=new Q(); q.shape([[-0.075,0.0467],[0.075,0.0467],[0,-0.0933]], 0, 0.02, C.trim);
    const m=q.build(P.legR, 0.05); m.position.set(0,-0.46166666666666667,0.125); m.name="靴子 (镜像) #9"; }
  { const q=new Q(); q.box(0,0,0, 0.205,0.03,0.305, C.trim, 0);
    const m=q.build(P.legR, 0.05);
    m.position.set(0,-0.722,0.05); m.rotation.set(0,0,0); m.name="靴子 (镜像) #10"; }
  // ---- 胸口星徽 (额外装饰) ----
  { const q=new Q(); q.shape([[0,0.082],[-0.0202,0.0279],[-0.078,0.0253],[-0.0328,-0.0106],[-0.0482,-0.0663],[0,-0.0344],[0.0482,-0.0663],[0.0328,-0.0106],[0.078,0.0253],[0.0202,0.0279]], 0, 0.028, C.trim);
    const m=q.build(P.body, 0.05); m.position.set(0.225,1.3150199999999999,0.205); m.name="胸口星徽 #1"; }
  // ---- 背部星徽 (额外装饰) ----
  { const q=new Q(); q.shape([[0,0.185],[-0.0457,0.0629],[-0.1759,0.0572],[-0.0739,-0.024],[-0.1087,-0.1497],[0,-0.0777],[0.1087,-0.1497],[0.0739,-0.024],[0.1759,0.0572],[0.0457,0.0629]], 0, 0.03, C.trim);
    const m=q.build(P.coatTails, 0.05); m.position.set(6.938893903907229e-19,-0.19999,-0.215); m.name="背部星徽 #1"; }
  // ---- 颈饰 (身体装饰) ----
  { const q=new Q(); q.box(0,0,0, 0.245,0.058,0.245, C.coat, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.435,0.03); m.rotation.set(0,0,0); m.name="颈饰 #1"; }
  { const q=new Q(); q.box(0,0,0, 0.06,0.048,0.028, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(-0.03,1.4,0.155); m.rotation.set(0,0,0.5); m.name="颈饰 #2"; }
  { const q=new Q(); q.box(0,0,0, 0.06,0.048,0.028, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0.03,1.4,0.155); m.rotation.set(0,0,-0.5); m.name="颈饰 #3"; }
  { const q=new Q(); q.box(0,0,0, 0.026,0.052,0.026, C.trim, 0);
    const m=q.build(P.body, 0.05);
    m.position.set(0,1.35,0.15); m.rotation.set(0,0,0); m.name="颈饰 #4"; }
  // ---- 头发（原作几何） (头发) ----
  __op("head",0,0,[0,1,2,3,4,5,18,19,20,21,22,23,72,73,74,75,76,77,90,91,92,93,94,95],[0,0.4024,-0.055],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #1",0.05,0.69);
  __op("head",0,5,[13],[-0.1477,0.36,0.2875],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #2",0.05,0.69);
  __op("head",0,6,[13],[-0.0327,0.36,0.2905],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #3",0.05,0.69);
  __op("head",0,7,[13],[0.0823,0.36,0.2935],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #4",0.05,0.69);
  __op("head",0,8,[13],[0.1973,0.36,0.2965],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #5",0.05,0.69);
  __op("head",0,11,[0,2,3,4,5,6,8,9,10,11],[-0.1449,0.3833,0.1347],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #6",0.05,0.69);
  __op("head",0,14,[13,14,15],[-0.0828,0.3922,-0.0167],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #7",0.05,0.69);
  __op("head",0,15,[4,5],[-0.255,0.36,0],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #8",0.05,0.69);
  __op("head",0,16,[4,5],[-0.2675,0.405,0.106],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #9",0.05,0.69);
  __op("head",0,17,[6,7],[0.255,0.36,0],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #10",0.05,0.69);
  __op("head",0,18,[6,7],[0.2675,0.405,0.106],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #11",0.05,0.69);
  __op("head",0,0,[6,7,12,13,28,29,34,35,54,55,56,57,58,59,78,79,80,81,82,83,84,85,86,87,88,89],[0.0001,0.2305,0.2125],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #12",0.05,0.69);
  __op("head",0,2,[0,1,6,7,12,13,22,23,28,29,34,35,48,49,50,51,52,53,54,55,56,57,58,59,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89],[-0.32,0.06,0.2019],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #13",0.05,0.69);
  __op("head",0,3,[0,1,6,7,12,13,22,23,28,29,34,35,48,49,50,51,52,53,54,55,56,57,58,59,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89],[0.32,0.06,0.2019],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #14",0.05,0.69);
  __op("head",0,4,null,[-0.2396,0.2388,0.272],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #15",0.05,0.69);
  __op("head",0,5,[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15],[-0.1231,0.2396,0.2742],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #16",0.05,0.69);
  __op("head",0,6,[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15],[0.0061,0.2502,0.2772],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #17",0.05,0.69);
  __op("head",0,7,[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15],[0.1211,0.2342,0.2802],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #18",0.05,0.69);
  __op("head",0,8,[0,1,2,3,4,5,6,7,8,9,10,11,12,14,15],[0.2361,0.2253,0.2832],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #19",0.05,0.69);
  __op("head",0,12,null,[0.24,0.28,0.331],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #20",0.05,0.69);
  __op("head",0,13,null,[0.25,0.21,0.338],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #21",0.05,0.69);
  __op("head",0,0,[8,9,10,11,14,15,16,17,24,25,26,27,30,31,32,33,60,61,64,65,66,67,70,71,96,97,100,101,102,103,106,107],[-0.0001,0.2285,-0.2202],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #22",0.05,0.69);
  __op("head",0,1,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,40,41,42,43,46,47,48,49,52,53,54,55,58,59,60,61,64,65,66,67,70,71,72,73,76,77,78,79,82,83,84,85,88,89,90,91,94,95,96,97,100,101,102,103,106,107],[0,0.07,-0.24],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #23",0.05,0.69);
  __op("head",0,2,[2,4,5,11,15,16,17,18,19,20,21,24,25,26,27,30,31,32,33,36,37,38,39,40,41,42,43,44,45,46,47,60,61,62,63,64,65,66,67,68,69,70,71,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107],[-0.3252,0.059,-0.1359],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #24",0.05,0.69);
  __op("head",0,3,[2,3,4,5,8,9,10,11,14,15,16,17,18,19,20,24,30,31,33,36,37,38,39,40,41,42,43,44,45,46,47,60,61,62,63,64,65,66,67,68,69,70,71,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107],[0.3252,0.061,-0.1359],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #25",0.05,0.69);
  __op("head",0,9,null,[-0.345,-0.03,-0.04],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #26",0.05,0.69);
  __op("head",0,10,null,[0.345,-0.03,-0.04],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #27",0.05,0.69);
  __op("head",1,4,[10],[0.2618,-0.2267,-0.4153],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #28",0.05,0.69);
  __op("head",1,5,[1,6,10,11,12,13,14,15],[-0.2931,-0.2971,-0.235],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #29",0.05,0.69);
  __op("head",1,6,[2,7,14,15,16,17,18,19],[0.2931,-0.2971,-0.247],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #30",0.05,0.69);
  __op("head",0,0,[36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53],[0,0.4337,-0.055],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #31",0.05,0.69);
  __op("head",0,14,[0,1,2,3,4,5,6,7,8,9,10,11,12],[-0.0627,0.4597,-0.0331],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #32",0.05,0.69);
  __op("head",0,0,[62],[-0.0971,0.155,0.0221],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #33",0.05,0.69);
  __op("head",0,2,[8,14],[-0.2564,-0.0022,0.0621],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #34",0.05,0.69);
  __op("head",0,3,[21,27],[0.2564,0.1222,0.0621],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #35",0.05,0.69);
  __op("head",0,11,[1,7],[-0.0555,0.3575,0.1067],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #36",0.05,0.69);
  __op("head",0,0,[63,68,69,98,99,104,105],[0.0139,0.2109,-0.3044],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #37",0.05,0.69);
  __op("head",0,1,[38,39,44,45,50,51,74,75,80,92,93,98],[0,0.2737,-0.24],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #38",0.05,0.69);
  __op("head",0,2,[3,10],[-0.2578,0.181,-0.1276],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #39",0.05,0.69);
  __op("head",0,3,[26],[0.255,0.1188,-0.0621],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #40",0.05,0.69);
  __op("head",1,0,[12,13],[-0.1865,0.145,-0.35],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #41",0.05,0.69);
  __op("head",1,1,[12,13],[-0.097,0.145,-0.359],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #42",0.05,0.69);
  __op("head",1,2,[12,13],[-0.0075,0.145,-0.368],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #43",0.05,0.69);
  __op("head",1,3,[12,13],[0.082,0.145,-0.377],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #44",0.05,0.69);
  __op("head",1,4,[12,13],[0.1715,0.145,-0.386],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #45",0.05,0.69);
  __op("head",0,1,[56,57,62,63,68,69,81,86,87,99,104,105],[0,-0.1337,-0.24],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #46",0.05,0.69);
  __op("head",0,2,[9],[-0.255,0.0012,-0.0621],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #47",0.05,0.69);
  __op("head",0,3,[25,32],[0.2578,-0.061,-0.1276],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #48",0.05,0.69);
  __op("head",1,0,[0,1,2,3,4,5,6,7,8,9,10,11,14,15],[-0.1737,-0.2931,-0.3744],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #49",0.05,0.69);
  __op("head",1,1,[0,1,2,3,4,5,6,7,8,9,10,11,14,15],[-0.0887,-0.2979,-0.3834],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #50",0.05,0.69);
  __op("head",1,2,[0,1,2,3,4,5,6,7,8,9,10,11,14,15],[0.025,-0.3026,-0.3924],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #51",0.05,0.69);
  __op("head",1,3,[0,1,2,3,4,5,6,7,8,9,10,11,14,15],[0.1099,-0.2979,-0.4014],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #52",0.05,0.69);
  __op("head",1,4,[0,1,2,3,4,5,6,7,8,9,11,14,15],[0.1898,-0.2982,-0.41],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #53",0.05,0.69);
  __op("head",1,5,[0,2,3,4,5,7,8,9,16,17,18,19,20,21,22,23],[-0.2111,-0.2515,-0.235],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #54",0.05,0.69);
  __op("head",1,6,[0,1,3,4,5,6,8,9,10,11,12,13,20,21,22,23],[0.2111,-0.2515,-0.247],[0,0,0],[1,1,1],C.hair,false,"头发（原作几何） #55",0.05,0.69);
  attachFace(head, { id:"brm", iris:[0x24537f,0x3f8fe6,0xe6f3ff] });
  return { root, body, head, arms:[armL,armR], legs:[legL,legR], coatTails, tail };
}