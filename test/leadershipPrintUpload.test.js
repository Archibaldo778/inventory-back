import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { leadershipPrintUpload } from '../utils/leadershipPrintUpload.js';
import { decodeKitchenPrintPdf } from '../utils/kitchenPrintPdf.js';

test('binary Kitchen PDF above old JSON size limit arrives intact with copy settings', async (t) => {
  const app = express();
  app.use(express.json({limit:'15mb'}));
  app.post('/print', leadershipPrintUpload, (req,res) => res.json({bytes:decodeKitchenPrintPdf(req.file.buffer).length,files:req.body.files}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>server.close());
  const pdf = new Blob(['%PDF-',new Uint8Array(16*1024*1024)],{type:'application/pdf'});
  const body = new FormData();body.append('kitchenReferences',pdf,'refs.pdf');body.append('files',JSON.stringify([{source:'kitchen_board',copies:2,pageCopies:[1,3]}]));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/print`,{method:'POST',body});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{bytes:pdf.size,files:[{source:'kitchen_board',copies:2,pageCopies:[1,3]}]});
});
