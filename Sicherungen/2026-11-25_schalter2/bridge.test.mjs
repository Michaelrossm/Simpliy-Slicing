import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const state=JSON.parse(fs.readFileSync(new URL('../frontend/initial_state.json',import.meta.url)));
const invokes=[];
const ctx={
  Uint8Array,Blob,JSON,Math,TextEncoder,TextDecoder,ArrayBuffer,Array,
  window:{}, btoa, atob,
};
ctx.window.fetch=async (url)=>({ok:true,json:async()=>[{key:'layer_height'}]});
ctx.window.__TAURI__={core:{invoke:async(name,args)=>{
  invokes.push(name);
  if(name==='get_workspace')return structuredClone(state);
  if(name==='save_workspace')return {ok:true};
  if(name==='detect_engine')return {configured:'',detected:[]};
  if(name==='export_profile')return btoa('not a real zip');
  throw Error(name);
}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../frontend/tauri-bridge.js',import.meta.url),'utf-8'),ctx);
test('Native get_workspace bridge loads existing profile state',async()=>{
  const r=await ctx.window.fetch('/api/state');
  assert.equal(r.ok,true);
  const v=await r.json();
  assert.equal(v.schema,1);
  assert.equal(v.processes.length,4);
  assert.ok(invokes.includes('get_workspace'));
});
test('Native state saving receives a value without flattening auto configure',async()=>{
  const r=await ctx.window.fetch('/api/state',{method:'PUT',body:JSON.stringify(state)});
  assert.equal((await r.json()).ok,true);
  assert.ok(invokes.includes('save_workspace'));
});
test('Config has available auto-config categories',()=>{
 const profile=state.profiles[0].profile;
 assert.ok(profile.categories.length>0);
 assert.ok(profile.category_order.length>0);
});
