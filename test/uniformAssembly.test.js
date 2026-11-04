import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUniformAssembly, resolveUniformAssembly } from '../utils/uniformAssembly.js';
const id='aaaaaaaaaaaaaaaaaaaaaaaa';
const body={_id:id,assetType:'addon',category:'Body',templateKey:'staff-v1',image:'trusted.png'};
test('assembly resolves catalog image instead of accepting supplied image',()=>{
 const choices=parseUniformAssembly(JSON.stringify([{modelId:id,colorId:'base',image:'untrusted.png'}]));
 const layers=resolveUniformAssembly(choices,[body],'staff-v1');
 assert.equal(layers[0].image,'trusted.png');
 assert.throws(()=>resolveUniformAssembly(choices,[body],'other'),/different/);
 assert.throws(()=>resolveUniformAssembly(choices,[{...body,archivedAt:new Date()}],'staff-v1'),/missing/);
 assert.throws(()=>resolveUniformAssembly([...choices,...choices],[body],'staff-v1'),/one model/);
 assert.throws(()=>parseUniformAssembly('[]'),/valid parts/);
});

test('blazer, Mandarin and Nehru cannot be combined even under different or legacy categories',()=>{
 const shirt={...body,_id:'bbbbbbbbbbbbbbbbbbbbbbbb',category:'Shirts',name:'Button Down Shirt'};
 const blazer={...body,_id:'cccccccccccccccccccccccc',category:'Jackets',name:'Blazer'};
 const mandarin={...body,_id:'dddddddddddddddddddddddd',category:'Mandarins',name:'Mandarin'};
 const nehru={...body,_id:'eeeeeeeeeeeeeeeeeeeeeeee',category:'Nehru',name:'Nehru'};
 const select=parts=>parts.map(p=>({modelId:p._id,colorId:'base'}));
 for(const jacket of [blazer,mandarin,nehru]) {
  const parts=[body,shirt,{...jacket,category:'Shirts'}];
  const layers=resolveUniformAssembly(select(parts),parts,'staff-v1');
  assert.equal(layers.length,3,'a legacy jacket and shirt are separate slots');
 }
 for(const pair of [[blazer,mandarin],[blazer,nehru],[mandarin,nehru]]) {
  const parts=[body,...pair];
  assert.throws(()=>resolveUniformAssembly(select(parts),parts,'staff-v1'),/one model/);
 }
 const tee={...body,_id:'ffffffffffffffffffffffff',category:'T-Shirts',name:'Crew Neck'};
 const parts=[body,tee,blazer];
 assert.equal(resolveUniformAssembly(select(parts),parts,'staff-v1').length,3);
});

test('custom Suit Jacket categories cannot bypass jacket exclusivity or occupy the shirt slot',()=>{
 const shirt={...body,_id:'bbbbbbbbbbbbbbbbbbbbbbbb',category:'Shirts',name:'Button Down Shirt'};
 const suit={...body,_id:'cccccccccccccccccccccccc',category:'Suit Jacket',name:'Suit Jacket'};
 const select=parts=>parts.map(p=>({modelId:p._id,colorId:'base'}));
 for(const [category,name] of [['Shirts','Mandarin'],['Mandarin','Classic'],['Nehru Jackets','Classic'],['Formal Wear','Burgundy Mandarin'],['Blazers','Classic']]) {
  const other={...body,_id:'dddddddddddddddddddddddd',category,name};
  for(const pair of [[suit,other],[other,suit]]) {
   const parts=[body,shirt,...pair];
   assert.throws(()=>resolveUniformAssembly(select(parts),parts,'staff-v1'),/one model/);
  }
 }
 for(const category of ['Suit Jacket','  SUIT JACKETS  ','Formal Wear']) {
  const parts=[body,shirt,{...suit,category}];
  assert.equal(resolveUniformAssembly(select(parts),parts,'staff-v1').length,3);
 }
 const pants={...body,_id:'eeeeeeeeeeeeeeeeeeeeeeee',category:'Pants',name:'Jacket matching pants'};
 const parts=[body,shirt,suit,pants];
 assert.equal(resolveUniformAssembly(select(parts),parts,'staff-v1').length,4);
});
