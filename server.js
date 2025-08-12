import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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