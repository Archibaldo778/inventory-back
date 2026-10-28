import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 1, fieldSize: 256 * 1024 },
}).single('kitchenReferences');

export const leadershipPrintUpload = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) return res.status(413).json({ error: 'The selected files exceed the 80 MB print job limit.' });
    if (typeof req.body?.files === 'string') {
      try { req.body.files = JSON.parse(req.body.files); }
      catch { return res.status(400).json({ error: 'Invalid print file selection.' }); }
    }
    return next();
  });
};
