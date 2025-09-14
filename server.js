import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: true, credentials: true }));
// Increase body limit to allow page preview (base64) and large canvases
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
// serve uploaded images statically: GET /uploads/<filename>
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// роуты товаров
import productRoutes from './routes/products.js';
import userRoutes from './routes/users.js';
import eventRoutes from './routes/events.js';
import deckRoutes from './routes/decks.js';
import pageRoutes from './routes/pages.js';
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/users', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/pages', pageRoutes);

// подключение к Mongo
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err));
}

// health-check
app.get('/', (req, res) => {
  res.send('Backend OK');
});

app.get('/api', (req, res) => {
  res.json({ message: 'API работает 🚀' });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
