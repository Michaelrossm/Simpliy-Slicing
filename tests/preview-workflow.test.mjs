import {test} from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../frontend/vendor/build/three.module.js';
import {Viewport} from '../frontend/viewport.js';
import {renderPreviewControls} from '../frontend/workbench.js';
const preview=(...heights)=>{
  const n=heights.length,fill=v=>new Float32Array(n).fill(v);
  return {
    count:n,roles:['Perimeter'],moveCounts:heights.map(()=>1),layers:heights.map((z,i)=>({z,end:i+1,travelEnd:0})),
    data:{from:Float32Array.from(heights.flatMap(z=>[0,0,z])),to:Float32Array.from(heights.flatMap(z=>[10,0,z])),
      width:fill(.5),height:fill(.2),speed:fill(20),flow:fill(2),role:new Uint32Array(n),travel:new Float32Array(0),roleCounts:new Uint32Array(n).fill(1)},
  };
};
function fakeViewport(){const v=Object.create(Viewport.prototype);v.modelGroup=new THREE.Group();v.overlayGroup=new THREE.Group();v.pathGroup=new THREE.Group();v.redraw=()=>{};return v}
test('preview draws round beads and dims earlier layers only while browsing',()=>{const v=fakeViewport(),data=preview(.2,.4),options={layer:1,metric:'type',single:false,travel:false,role:'all'};
 assert.equal(v.setToolpath(data,options).shown,2);const mesh=v.pathGroup.children[0];assert.equal(mesh.isMesh,true);assert.equal(mesh.geometry.instanceCount,2);
 assert.ok(mesh.geometry.getAttribute('position').count>=40);assert.equal(mesh.material.uniforms.uDim.value,1);assert.equal(mesh.material.clipping,true);
 v.setToolpath(data,{...options,layer:0});assert.equal(v.pathGroup.children[0],mesh);assert.equal(mesh.geometry.instanceCount,1);assert.equal(mesh.material.uniforms.uDim.value<1,true);
 assert.deepEqual(new THREE.Box3().setFromObject(v.pathGroup).max.toArray().map(n=>+n.toFixed(2)),[10.25,.25,.4]);
 v.setToolpath(null,{});assert.equal(v.modelGroup.visible,true);assert.equal(v.pathGroup.children.length,0)});
test('preview legend includes real colour scale and selectable layer height',()=>{const html=renderPreviewControls(preview(.2),{layer:0,metric:'flow',role:'all',single:false,travel:false},{path:'print.gcode',stale:false});assert.match(html,/preview-gradient/);assert.match(html,/preview-range/);assert.match(html,/value="height"/);assert.match(html,/data-preview="layer"/);assert.match(html,/data-preview="minLayer"/)});
test('layer range limits the displayed toolpaths and preserves selected-layer highlight',()=>{const v=fakeViewport(),data=preview(.2,.4,.6);const out=v.setToolpath(data,{layer:2,minLayer:1,metric:'height',single:false,travel:false,role:'all'});assert.equal(out.shown,2);assert.ok(Math.abs(out.min-.2)<1e-6&&Math.abs(out.max-.2)<1e-6);assert.equal(v.pathGroup.children[0].material.uniforms.uFirst.value,1)});
test('print bed does not receive the object shadow',()=>{const v=fakeViewport();v.bedGroup=new THREE.Group();v.sun=new THREE.DirectionalLight();v.sun.castShadow=true;v.setView=()=>{};v.setBed({minX:0,maxX:220,minY:0,maxY:220,height:250,points:[[0,0],[220,0],[220,220],[0,220]]});const bed=v.bedGroup.children.find(x=>x.isMesh);assert.ok(bed);assert.equal(bed.receiveShadow,false)});
test('bed is front-sided so it cannot cover a model viewed from below',()=>{const v=fakeViewport();v.bedGroup=new THREE.Group();v.sun=new THREE.DirectionalLight();v.sun.castShadow=true;v.setView=()=>{};v.setBed({minX:0,maxX:220,minY:0,maxY:220,height:250,points:[[0,0],[220,0],[220,220],[0,220]]});const bed=v.bedGroup.children.find(x=>x.isMesh);assert.equal(bed.material.side,THREE.FrontSide);assert.ok(bed.geometry.getAttribute('normal').array[2]>0)});
