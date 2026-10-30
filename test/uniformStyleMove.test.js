import test from 'node:test';
import assert from 'node:assert/strict';
import { uniformStyleMove } from '../utils/uniformStyleMove.js';
const source={_id:'pants',assetType:'addon',category:'Pants',templateKey:'staff-v1',colorName:'Black',image:'black.png',variants:[{id:'khaki',colorName:'Khaki',image:'khaki.png',alternateImage:'loops.png'}]};
const target={_id:'chinos',assetType:'addon',category:'Pants',templateKey:'staff-v1',colorName:'Olive',image:'olive.png'};
test('dropdown reassignment appends a color to existing style without touching other colors',()=>{
 const plan=uniformStyleMove({source,target,colorId:'khaki',targetColorId:'new-color'});
 assert.deepEqual(plan.sourceUpdate.variants,[]);
 assert.equal(plan.destination.variants[0].image,'khaki.png');
 assert.equal(plan.destination.variants[0].alternateImage,'loops.png');
 assert.equal(plan.destination.previousSelections[0].targetColorId,'new-color');
 assert.equal(source.variants.length,1);
});
test('moving the first color never reuses its identity for another color',()=>{
 const plan=uniformStyleMove({source,target,colorId:'base',targetColorId:'black'});
 assert.equal(plan.sourceUpdate.baseArchived,true);
 assert.equal(plan.sourceUpdate.variants,undefined);
 assert.equal(plan.sourceUpdate.archivedAt,undefined);
 assert.equal(plan.destination.variants[0].colorName,'Black');
});
test('moving last remaining color archives empty source and preserves earlier saved links',()=>{
 const plan=uniformStyleMove({source:{...source,baseArchived:true,previousSelections:[{modelId:'old',colorId:'old-khaki',targetColorId:'khaki'}]},target,colorId:'khaki',targetColorId:'new-khaki'});
 assert.ok(plan.sourceUpdate.archivedAt instanceof Date);
 assert.deepEqual(plan.destination.previousSelections.map(x=>[x.modelId,x.targetColorId]),[['old','new-khaki'],['pants','new-khaki']]);
});
test('invalid, missing and duplicate destinations cannot remove source colors',()=>{
 assert.throws(()=>uniformStyleMove({source,target:{...target,colorName:'Khaki'},colorId:'khaki'}),/already has/);
 assert.throws(()=>uniformStyleMove({source,target:{...target,category:'Shoes'},colorId:'khaki'}),/same category/);
 assert.throws(()=>uniformStyleMove({source,target,colorId:'missing'}),/not found/);
 assert.equal(source.variants.length,1);
});
