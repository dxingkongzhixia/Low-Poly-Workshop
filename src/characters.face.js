/* =========================================================================
   characters.face.js
   —— 原作「头 + 脸」生成管线，逐字提取自 bundle（约 1.139M–1.146M）
     jT(id) : 用 Uint8Array 逐像素画 96x80 的脸（眼白/虹膜(AT 色表)/眉毛/腮红/嘴）
     NT(id) : 圆角头网格（.61 x .5 x .47，用原作自研 RoundedBoxGeometry）
     MT(headGroup, id) : 组装头 + 6 材质（第 4 个 = +Z 面用脸贴图）
   ========================================================================= */
import * as THREE from 'three';

const gg = THREE.BoxGeometry;
const q  = THREE.Vector3;
const Sb = THREE.MeshStandardMaterial;
const pg = THREE.Mesh;
const Bp = THREE.MathUtils;
const y_ = THREE.DataTexture;
const lf = THREE.RGBAFormat;
const ip = THREE.SRGBColorSpace;
const Vd = THREE.NearestFilter;
const J  = THREE.Color;

/* ==================== ↓↓↓ 原作代码（逐字） ↓↓↓ ==================== */

/* kT */
var kT=class e extends gg{constructor(e=1,t=1,n=1,r=2,i=.1){let a=r*2+1;if(i=Math.min(e/2,t/2,n/2,i),super(1,1,1,a,a,a),this.type=`RoundedBoxGeometry`,this.parameters={width:e,height:t,depth:n,segments:r,radius:i},a===1)return;let o=this.toNonIndexed();this.index=null,this.attributes.position=o.attributes.position,this.attributes.normal=o.attributes.normal,this.attributes.uv=o.attributes.uv;let s=new q,c=new q,l=new q(e,t,n).divideScalar(2).subScalar(i),u=this.attributes.position.array,d=this.attributes.normal.array,f=this.attributes.uv.array,p=u.length/6,m=new q,h=.5/a;for(let r=0,a=0;r<u.length;r+=3,a+=2)switch(s.fromArray(u,r),c.copy(s),c.x-=Math.sign(c.x)*h,c.y-=Math.sign(c.y)*h,c.z-=Math.sign(c.z)*h,c.normalize(),u[r+0]=l.x*Math.sign(s.x)+c.x*i,u[r+1]=l.y*Math.sign(s.y)+c.y*i,u[r+2]=l.z*Math.sign(s.z)+c.z*i,d[r+0]=c.x,d[r+1]=c.y,d[r+2]=c.z,Math.floor(r/p)){case 0:m.set(1,0,0),f[a+0]=OT(m,c,`z`,`y`,i,n),f[a+1]=1-OT(m,c,`y`,`z`,i,t);break;case 1:m.set(-1,0,0),f[a+0]=1-OT(m,c,`z`,`y`,i,n),f[a+1]=1-OT(m,c,`y`,`z`,i,t);break;case 2:m.set(0,1,0),f[a+0]=1-OT(m,c,`x`,`z`,i,e),f[a+1]=OT(m,c,`z`,`x`,i,n);break;case 3:m.set(0,-1,0),f[a+0]=1-OT(m,c,`x`,`z`,i,e),f[a+1]=1-OT(m,c,`z`,`x`,i,n);break;case 4:m.set(0,0,1),f[a+0]=1-OT(m,c,`x`,`y`,i,e),f[a+1]=1-OT(m,c,`y`,`x`,i,t);break;case 5:m.set(0,0,-1),f[a+0]=OT(m,c,`x`,`y`,i,e),f[a+1]=1-OT(m,c,`y`,`x`,i,t);break}}static fromJSON(t){return new e(t.width,t.height,t.depth,t.segments,t.radius)}},AT={lee:[6902056,13476935,15914370],chen:[6695747,11749991,15899823],hoshiguma:[4085069,7510401,12176042],swire:[2119741,4893546,10608548],lappland:[5663079,9415331,12767944],texas:[2700367,14190910,15973488],exusiai:[8409643,14263118,16766599],sora:[5322600,10247070,15053198],mostima:[1398124,2592677,7391958],croissant:[6832441,11958353,14724992]}

/* OT */
function OT(e,t,n,r,i,a){let o=2*Math.PI*i/4,s=Math.max(a-2*i,0),c=Math.PI/4;DT.copy(t),DT[r]=0,DT.normalize();let l=.5*o/(o+s),u=1-DT.angleTo(e)/c;return Math.sign(DT[n])===1?u*l:s/(o+s)+l+l*(1-u)}

/* DT */
var DT=new q

/* AT */
var AT={lee:[6902056,13476935,15914370],chen:[6695747,11749991,15899823],hoshiguma:[4085069,7510401,12176042],swire:[2119741,4893546,10608548],lappland:[5663079,9415331,12767944],texas:[2700367,14190910,15973488],exusiai:[8409643,14263118,16766599],sora:[5322600,10247070,15053198],mostima:[1398124,2592677,7391958],croissant:[6832441,11958353,14724992]}

/* jT */
function jT(e,t=!1,n=!1,r=!1,i=1){let a=new Uint8Array(7680*4),o=(e,t,n,r,i)=>{for(let o=Math.max(0,t);o<Math.min(80,t+r);o++)for(let t=Math.max(0,e);t<Math.min(96,e+n);t++){let e=(o*96+t)*4;a[e]=i>>16&255,a[e+1]=i>>8&255,a[e+2]=i&255,a[e+3]=255}},s=[`lee`,`aak`,`hung`,`waaifu`].includes(e);if(o(0,0,96,80,s?15656404:16243144),!s){let t=e===`lappland`||r?15181229:15382707;o(5,52,12,4,t),o(79,52,12,4,t)}if(e===`waaifu`){if(r)for(let e=0;e<96;e++){let t=Math.round(49+7*Math.min(1,Math.abs(e-47.5)/28));o(e,0,1,t,15174194)}for(let e of[0,80])o(e,0,16,51,15174194),o(e,36,13,5,3156520),o(e,48,10,5,3156520)}let c=n?[8559017,12110807,14871022]:AT[e]??AT.texas;for(let n=0;n<2;n++){let a=n===0?7:56;if(e===`lappland`||r){let r=e=>Math.round(33+(e-33)*1.05),s=(e,t,r,a,s)=>{let c=n===0?23.5:72.5,l=37.5,u=Math.round(c+(e-c)*i),d=Math.round(c+(e+r-c)*i),f=Math.round(l+(t-l)*i),p=Math.round(l+(t+a-l)*i);o(u,f,d-u,p-f,s)},l=(e,t,i,o,c)=>{let l=r(e),u=r(e+i);s(a+(n===0?l:33-u),t,u-l,o,c)},u=()=>{l(11,18,11,3,16774887),l(9,21,15,4,16774887),l(12,25,9,2,16774887)};if(e===`hung`){if(l(11,19,11,3,12467238),l(9,22,15,3,12467238),t){l(2,36,29,4,2827312),l(7,40,20,2,10841210);continue}l(3,27,29,24,16052973),l(6,51,23,3,16052973),l(7,30,23,20,15637286),l(10,48,17,5,16766042),l(10,33,17,14,16761667),l(17,36,4,7,3287326),l(0,26,33,5,1579298),l(0,30,4,17,1579298),l(4,49,4,4,1579298),s(a+(n===0?8:5),32,4,5,16775656);continue}if(t){e===`waaifu`&&u(),l(2,36,29,4,2827312),l(7,40,20,2,10841210);continue}l(2,24,29,3,14459052),l(3,27,29,24,16052973),l(6,51,23,3,16052973),l(11,27,17,23,c[1]),l(14,50,11,4,c[2]),l(11,27,17,e===`texas`?12:10,c[0]),l(15,32,10,13,c[0]),l(12,45,15,5,c[1]),l(14,48,11,4,c[2]),e===`waaifu`?u():l(4,21,23,e===`exusiai`?2:5,e===`exusiai`?6635591:1579298),l(0,26,33,e===`exusiai`?3:5,1579298),l(0,30,4,17,1579298),l(4,49,4,4,1579298),s(a+(n===0?r(11):33-r(28))+1,32,4,5,16775656);continue}if(t){o(a+2,36,29,4,2827312),o(a+7,40,20,2,7822178);continue}o(a+3,27,29,24,16052973),o(a+6,51,23,3,16052973),o(a+11,27,17,23,c[1]),o(a+14,50,11,4,c[2]),o(a+11,27,17,e===`texas`?12:8,c[0]),o(a+15,32,10,13,c[0]),o(a+12,45,15,5,c[1]),o(a+14,48,11,4,c[2]),o(a+4,21,23,e===`exusiai`?2:5,e===`exusiai`?6635591:1579298),o(a,26,33,e===`exusiai`?3:5,1579298),o(n===0?a:a+29,30,4,17,1579298),o(n===0?a+4:a+25,49,4,4,1579298),o(a+12,32,4,5,16775656)}if(e===`exusiai`||e===`sora`?(o(40,61,3,2,10975099),o(43,63,3,2,10975099),o(46,64,6,2,10975099),o(52,63,3,2,10975099),o(55,61,3,2,10975099)):e===`chen`?(o(42,64,3,2,12162969),o(45,63,6,2,12162969),o(51,64,3,2,12162969)):o(42,e===`lappland`?61:63,12,3,12162969),e===`lappland`)for(let[e,t]of[[13,19],[55,61]])for(let r=e;r<=t;r++)o(78-Math.floor((r-13)/7.5),r,2,1,n?10978953:12097944);if(e===`lee`&&!r){o(0,0,96,80,14342351);for(let e of[9,57]){if(t){o(e,34,29,3,3683118);continue}o(e,29,28,12,15657173),o(e+10,29,13,13,13476935),o(e+16,29,3,12,3157028),o(e+11,31,3,3,16772270),o(e-1,27,31,4,3749166),o(e+3,25,24,3,3749166),o(e+3,41,23,2,7827557)}}let l=new y_(a,96,80,lf);return l.colorSpace=ip,l.magFilter=Vd,l.minFilter=Vd,l.generateMipmaps=!1,l.flipY=!0,l.needsUpdate=!0,l}

/* NT */
function NT(e,t=4){let n=new kT(.61,.5,.47,t,.095),r=n.getAttribute(`position`);for(let t=0;t<r.count;t++){let n=r.getX(t),i=r.getY(t),a=r.getZ(t),o=Bp.smoothstep(-i,.015,.25),s=n*(1-.38*o),c=i-.035*o,l=a-.035*o;if(e!==`emperor`){let e=Math.max(0,-c-.205);r.setXYZ(t,s,c+e*.62,l-e*.5)}else r.setXYZ(t,s,c,l)}return r.needsUpdate=!0,n.computeVertexNormals(),n.computeBoundingBox(),n.computeBoundingSphere(),n}

/* MT */
function MT(e,t){let n=jT(t),r=jT(t,!0),i=new Sb({map:n,roughness:.92,metalness:0}),a=new Sb({color:16243144,roughness:.92}),o=new pg(NT(t),[a,a,a,a,i,a]);return o.name=`rounded-cheeks-and-chin`,o.position.y=.035,o.castShadow=!0,o.receiveShadow=!0,e.add(o),{material:i,open:n,closed:r}}

/* ==================== ↑↑↑ 原作代码（逐字） ↑↑↑ ==================== */

/** 给 headGroup 装上原作的「头 + 脸」；iris 可传 [3 个色值] 覆盖虹膜
 *  注意：jT 是直接按下标读 c[0]/c[1]/c[2]，所以这里必须存「数组」而不是 {iris:[...]} */
export function attachFace(headGroup, { id = 'texas', iris = null } = {}){
  if(Array.isArray(iris) && iris.length){
    AT[id] = iris.slice();     // [暗部, 主色, 高光]
  }
  return MT(headGroup, id);   // -> { material, open, closed }
}

export { AT, jT, NT, MT };
