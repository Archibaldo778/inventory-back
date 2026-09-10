import { Router } from 'express';
import { createBrotherProductLabel } from '../utils/brotherLabelTemplate.js';

const router = Router();

router.get('/product-1x1/:fileName', async (req, res) => {
  try {
    const inventoryCode = String(req.params.fileName || '').replace(/\.lbx$/i, '');
    const appOrigin = process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || 'https://occdecks.com';
    const label = await createBrotherProductLabel(inventoryCode, appOrigin);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${inventoryCode}.lbx"`,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': String(label.length),
    });
    return res.send(label);
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      error: error instanceof Error ? error.message : 'Failed to build Brother label',
    });
  }
});

export default router;
