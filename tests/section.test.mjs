import {test} from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../frontend/vendor/build/three.module.js';
import {Viewport,instanceModelCopies} from '../frontend/viewport.js';
import {sectionPlaneSpec,sectionRange,clampSectionPosition} from '../frontend/section.js';
import {renderDock,renderQuickbar} from '../frontend/workbench.js';
const bed={minX:0,maxX:250,minY:0,maxY:210,height:210,points:[[0,0],[250,0],[250,210],[0,210]]};
function view(){const v=Object.create(Viewport.prototype);v.modelGroup=new THREE.Group();v.pathGroup=new THREE.Group();v.sectionGroup=new THREE.Group();v.sectionBases=new WeakMap();v.bed=bed;v.bedKey='bed';v.redraw=()=>{};return v}
test('pillar deltas retain the GPU instances of unchanged groups', () => {
  const viewport = view();
  viewport.supportGroup = new THREE.Group();
  const group = (id, x) => ({id, boxes: new Float32Array([x, 5, 2, 1, 1, 4])});
  const near = group('near', 3);
  const far = group('far', 170);
  const show = pillarGroups => viewport.setSupports(new Map([['model', {
    pillarGroups, body: {positions: []},
  }]]));
  show([near, far]);
  const [removed, kept] = viewport.supportGroup.children;
  let releases = 0;
  removed.addEventListener('dispose', () => releases++);
  show([group('near', 4), far]);
  assert.ok(viewport.supportGroup.children.includes(kept));
  assert.ok(!viewport.supportGroup.children.includes(removed));
  assert.equal(releases, 1);
});
test('section axes, directions, and bounds are computed in world coordinates',()=>{assert.deepEqual(sectionRange(bed,'+X'),[0,250]);assert.deepEqual(sectionRange(bed,'-Y'),[0,210]);assert.equal(clampSectionPosition(999,bed,'+Z'),210);assert.deepEqual(sectionPlaneSpec('+X',25),{normal:[1,0,0],constant:-25,index:0});assert.deepEqual(sectionPlaneSpec('-X',25),{normal:[-1,0,0],constant:25,index:0});assert.throws(()=>sectionPlaneSpec('Z',4))});
test('section clips model and preview, reverses direction and restores original model clipping',()=>{const v=view(),base=new THREE.Plane(new THREE.Vector3(0,0,1),-3),modelMat=new THREE.MeshBasicMaterial({clippingPlanes:[base]}),pathMat=new THREE.MeshBasicMaterial();v.modelGroup.add(new THREE.Mesh(new THREE.BoxGeometry(2,2,2),modelMat));v.pathGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),pathMat));let opts={enabled:true,orientation:'+X',position:25,showPlane:true,showGizmo:true};v.setSection(opts);assert.equal(modelMat.clippingPlanes.length,2);assert.equal(pathMat.clippingPlanes.length,1);assert.equal(modelMat.clippingPlanes[0],base);assert.ok(pathMat.clippingPlanes[0].distanceToPoint(new THREE.Vector3(30,0,0))>0);assert.equal(modelMat.clipShadows,true);assert.ok(v.sectionGroup.children.length>=2);opts={...opts,orientation:'-X',showPlane:false,showGizmo:false};v.setSection(opts);assert.ok(pathMat.clippingPlanes[0].distanceToPoint(new THREE.Vector3(20,0,0))>0);assert.equal(v.sectionGroup.children.length,0);v.setSection({...opts,enabled:false});assert.deepEqual(modelMat.clippingPlanes,[base]);assert.equal(pathMat.clippingPlanes,null);assert.equal(modelMat.clipShadows,false)});
test('bottom view is genuinely below the bed',()=>{const v=view();v.camera=new THREE.PerspectiveCamera();v.controls={target:new THREE.Vector3(),update(){}};v.setView('bottom');assert.ok(v.camera.position.z<v.controls.target.z)});
test('section panel and support panel are accessible',()=>{const section={enabled:true,orientation:'+Y',position:100,showPlane:true,showGizmo:true,pickPoint:false};const html=renderDock('section',{section,sectionRange:[0,210]});assert.match(html,/data-section="orientation"/);assert.match(html,/data-section="position"/);assert.match(html,/data-action="section-flip"/);assert.match(html,/data-action="section-pick"/);const support=renderDock('supports',{});assert.match(support,/Bitte zuerst ein Modell/);const quick=renderQuickbar('section',true,false);assert.match(quick,/data-tool="section"/);assert.match(quick,/data-view="bottom"/);assert.match(quick,/data-action="support-add"/)});
test('point picking skips clipped hits and selects a visible point',()=>{const v=view(),handlers={};v.renderer={domElement:{addEventListener:(name,fn)=>{(handlers[name]??=[]).push(fn)}}};v.section={enabled:true,pickPoint:true};v.sectionPlane=new THREE.Plane(new THREE.Vector3(1,0,0),-10);v.placed=new Map([['a',{body:{}}]]);v.ray=()=>({intersectObjects:()=>[{point:new THREE.Vector3(5,0,0),object:{material:{}}},{point:new THREE.Vector3(15,2,3),object:{material:{}}}]});let point=null;v.on={sectionPoint:p=>{point=p}};v.bindPointer();handlers.pointerdown[0]({button:0,stopImmediatePropagation(){}});assert.deepEqual(point,[15,2,3])});
test('initial section can target the actual object rather than empty build volume',()=>{const v=view();const mesh=new THREE.Mesh(new THREE.BoxGeometry(20,30,40),new THREE.MeshBasicMaterial());mesh.position.set(80,90,20);v.modelGroup.add(mesh);assert.deepEqual(v.sectionExtent('+X'),[70,90]);assert.deepEqual(v.sectionExtent('-Z'),[0,40])});
test('analysis minima share one instanced sphere, retain positions and release resources',()=>{
 const v=view();v.markGroup=new THREE.Group();const holder=new THREE.Group();
 v.placed=new Map([['a',{holder,body:{},box:{offset:[0,0,0]}}]]);
 v.setAnalysis('a',{detectMinima:true,heatmap:false,overhangAngle:45},new Float32Array([1,2,3,4,5,6]));
 assert.equal(v.markGroup.children.length,1);const points=v.markGroup.children[0];assert.equal(points.isInstancedMesh,true);assert.equal(points.count,2);
 const matrix=new THREE.Matrix4();points.getMatrixAt(1,matrix);assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(),[4,5,6]);
 let geo=0,mat=0;points.geometry.addEventListener('dispose',()=>geo++);points.material.addEventListener('dispose',()=>mat++);
 v.setAnalysis(null,{},null);assert.equal(v.markGroup.children.length,0);assert.equal(geo,1);assert.equal(mat,1);
});
test('model copies instance shared geometry, keep independent picking, clipping and resource ownership',()=>{
 const v=view(),geometry=new THREE.BoxGeometry(2,2,2),mesh={},items=[];v.placed=new Map();v.geometries=new WeakMap();v.tool={name:'select'};
 for(const [id,x,color] of [['a',10,0xff0000],['b',20,0x00ff00],['selected',30,0x0000ff]]){
  const holder=new THREE.Group();holder.matrixAutoUpdate=false;holder.matrix.makeTranslation(x,10,10);
  const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide}));body.userData={id,shared:true};holder.add(body);v.modelGroup.add(holder);
  const item={holder,body,model:{id},mesh};items.push(item);v.placed.set(id,item);
 }
 const batches=instanceModelCopies(items,'selected',v.modelGroup);assert.equal(batches.length,1);const batch=batches[0];assert.equal(batch.count,2);assert.equal(batch.geometry,geometry);
 assert.equal(items[0].body.visible,false);assert.equal(items[1].body.visible,false);assert.equal(items[2].body.visible,true);
 const matrix=new THREE.Matrix4();batch.getMatrixAt(1,matrix);assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(),[20,10,10]);
 const color=new THREE.Color();batch.getColorAt(1,color);assert.equal(color.getHex(),0x00ff00);
 v.modelGroup.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(10,10,20),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(items[0].body,false)[0].object.userData.id,'a');
 v.setSection({enabled:true,orientation:'+X',position:15,showPlane:false,showGizmo:false});assert.ok(batch.material.clippingPlanes?.length);
 let materialDisposed=0,geometryDisposed=0;batch.material.addEventListener('dispose',()=>materialDisposed++);geometry.addEventListener('dispose',()=>geometryDisposed++);
 v.setModels([],new Map(),null);assert.equal(materialDisposed,1);assert.equal(geometryDisposed,0);
});
test('painted, cut, mirrored and selected models keep independent rendering',()=>{
 const group=new THREE.Group(),shared={},geometry=new THREE.BoxGeometry(1,1,1);
 const create=(id,extras={},mirrored=false)=>{const holder=new THREE.Group();holder.matrixAutoUpdate=false;if(mirrored)holder.matrix.makeScale(-1,1,1);const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());holder.add(body);return {holder,body,mesh:shared,model:{id,...extras}}};
 const items=[create('selected'),create('painted',{paint:{support:{0:1}}}),create('cut',{volumes:[{cut:'above'}]}),create('mirrored',{},true)];
 assert.equal(instanceModelCopies(items,'selected',group).length,0);assert.ok(items.every(item=>item.body.visible));
});
test('manual support preview renders a visible pillar with coordinates and clears',async()=>{
 const v=view();v.supportPreviewGroup=new THREE.Group();v.supportHint={textContent:''};v.tool={mode:'add'};
 v.supportTargetAt=()=>({modelId:'a',kind:'bed',xyz:[4,8,0]});
 v.on={supportPreview:async()=>({label:'Vorschau',x:4,y:8,low:0,high:10,width:4,vertices:new Float32Array([2,6,0,6,6,0,2,10,10]),indices:new Uint32Array([0,1,2])})};
 await v.showSupportPreview({});assert.equal(v.supportPreviewGroup.children.length,2);assert.match(v.supportHint.textContent,/4\.00 x 4\.00 mm/);assert.match(v.supportHint.textContent,/X 4\.00/);
 v.clearSupportPreview();assert.equal(v.supportPreviewGroup.children.length,0);assert.equal(v.supportHint.textContent,'');
});
