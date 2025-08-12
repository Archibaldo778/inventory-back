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
app.use(express.json());
// serve uploaded images statically: GET /uploads/<filename>
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// роуты товаров
import productRoutes from './routes/products.js';
app.use('/api/products', productRoutes);

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