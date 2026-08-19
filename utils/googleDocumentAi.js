const PROCESS_TIMEOUT_MS = 60_000;
let cachedClient = null;
let cachedEndpoint = '';

const requiredConfig = () => {
  const projectId = String(process.env.GOOGLE_CLOUD_PROJECT_ID || '').trim();
  const location = String(process.env.GOOGLE_DOCUMENT_AI_LOCATION || '').trim().toLowerCase();
  const processorId = String(process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID || '').trim();
  if (!projectId || !location || !processorId) {
    const error = new Error('Document AI is not configured');
    error.statusCode = 503;
    throw error;
  }
  return { projectId, location, processorId };
};

const textFromLayout = (documentText, layout) => {
  const segments = layout?.textAnchor?.textSegments || [];
  return segments.map((segment) => {
    const start = Number(segment?.startIndex || 0);
    const end = Number(segment?.endIndex || 0);
    return String(documentText || '').slice(start, end);
  }).join('').replace(/\s+/g, ' ').trim();
};

const rowCells = (documentText, row) => (
  (Array.isArray(row?.cells) ? row.cells : []).map((cell) => textFromLayout(documentText, cell?.layout))
);

const serializeDocument = (document) => {
  const text = String(document?.text || '');
  const tables = [];
  (Array.isArray(document?.pages) ? document.pages : []).forEach((page) => {
    (Array.isArray(page?.tables) ? page.tables : []).forEach((table) => {
      tables.push({
        headerRows: (Array.isArray(table?.headerRows) ? table.headerRows : []).map((row) => rowCells(text, row)),
        bodyRows: (Array.isArray(table?.bodyRows) ? table.bodyRows : []).map((row) => rowCells(text, row)),
      });
    });
  });
  return { text, tables };
};

const documentClient = async (location) => {
  const endpoint = `${location}-documentai.googleapis.com`;
  if (cachedClient && cachedEndpoint === endpoint) return cachedClient;
  const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');
  cachedClient = new DocumentProcessorServiceClient({ apiEndpoint: endpoint });
  cachedEndpoint = endpoint;
  return cachedClient;
};

export const recognizeDocuments = async (files) => {
  const { projectId, location, processorId } = requiredConfig();
  const client = await documentClient(location);
  const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
  const documents = [];
  for (const file of files) {
    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      },
    }, { timeout: PROCESS_TIMEOUT_MS });
    documents.push(serializeDocument(result?.document));
  }
  return documents;
};
