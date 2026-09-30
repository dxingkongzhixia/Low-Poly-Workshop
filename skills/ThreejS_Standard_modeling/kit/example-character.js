import * as THREE from 'three';
import { M, profileExtrude, ribbon, sweep, panel, joint, part, mirrorPart, variant, detailLayer } from './standard-modeling-kit.js';

// Original, non-branded example. It demonstrates authored silhouettes and layers,
// not a recreation of the extracted reference character.
export function createExampleCharacter({ desolate=false }={}) {
  const root=new THREE.Group();root.name='original-modular-character';
  const head=part(root,profileExtrude('custom-head',[[0,.55],[.28,.4],[.34,.05],[.2,-.25],[0,-.32],[-.2,-.25],[-.34,.05],[-.28,.4]],.34,M.skin,'base-head',.035));head.position.y=1.9;
  const hair=part(root,profileExtrude('layered-crown',[[-.38,.35],[0,.56],[.38,.35],[.3,-.12],[.08,.12],[0,-.2],[-.08,.12],[-.3,-.12]],.38,M.cloth,'hair',.025));hair.position.set(0,2.05,-.02);
  const body=part(root,sweep('custom-torso',[[0,1.05,0],[0,1.42,0],[0,1.72,0]],{sides:8,radii:[[.3,.18],[.38,.22],[.3,.18]]},M.cloth,'base-body'));
  const coat=part(root,panel('asymmetric-coat',[[-.48,.5],[.34,.45],[.52,-.45],[.05,-.62],[-.2,-.2],[-.58,-.35]],.08,M.lightCloth,'clothing'));coat.position.set(.08,1.15,.2);coat.rotation.x=-.08;
  for(const side of [-1,1]){const arm=joint(`arm-pivot-${side<0?'L':'R'}`,[side*.38,1.48,0]);part(root,arm);part(arm,sweep('custom-arm',[[0,0,0],[side*.18,-.28,0],[side*.2,-.58,.02]],{sides:6,radii:[[.11,.11],[.1,.1],[.08,.08]]},M.skin,'base-arm'));part(arm,ribbon('sleeve-panel',[[0,0,.11],[side*.18,-.3,.11],[side*.2,-.6,.11]],[.22,.2,.16],.035,M.lightCloth,'sleeve'));}
  const tail=part(root,ribbon('layered-tail',[[.25,1.15,-.15],[.5,.85,-.2],[.65,.48,-.12],[.56,.2,-.02]],[.2,.17,.11,.02],.06,M.cloth,'tail'));tail.rotation.z=-.15;
  detailLayer(root,'collar-trim',[[-.28,1.6],[0,1.7],[.28,1.6],[.18,1.5],[0,1.57],[-.18,1.5]]);
  if(desolate) variant(root,true,panel('desolate-shoulder',[[-.4,.15],[.1,.25],[.28,-.3],[-.18,-.18]],.06,M.accent,'variant')); else variant(root,true,panel('classic-badge',[[-.12,.12],[.12,.12],[.12,-.12],[-.12,-.12]],.03,M.accent,'variant'));
  return root;
}
