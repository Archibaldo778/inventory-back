import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { decodeKitchenPrintPdf } from '../utils/kitchenPrintPdf.js';
import { mergeLeadershipPrintPdfs } from '../utils/leadershipPrintPdf.js';
test('references keep every dish page and its orientation when combined with other leadership files and copies', async () => {
  const refs = await PDFDocument.create();
  refs.addPage([612,792]); refs.addPage([792,612]);
  const other = await PDFDocument.create();other.addPage([612,792]);
  const buffer = decodeKitchenPrintPdf(Buffer.from(await refs.save()).toString('base64'));
  const result = await mergeLeadershipPrintPdfs({ documents:[
    {fileName:'other.pdf',buffer:Buffer.from(await other.save()),copies:1},
    {fileName:'refs.pdf',buffer,copies:2},
  ]});
  const merged = await PDFDocument.load(result);
  assert.deepEqual(merged.getPages().map(p=>p.getSize()),[
    {width:612,height:792},{width:612,height:792},{width:792,height:612},{width:612,height:792},{width:792,height:612},
  ]);
});
test('invalid or oversized uploaded reference PDFs are rejected', () => {
  for(const value of ['',null,'bad!',Buffer.from('thumbnail').toString('base64'),'A'.repeat(12*1024*1024+1)]) assert.throws(()=>decodeKitchenPrintPdf(value));
});
