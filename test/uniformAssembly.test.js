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
