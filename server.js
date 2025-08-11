import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// root health-check
app.get('/', (req, res) => {
  res.send('Backend OK');
});

// тестовый маршрут
app.get('/api', (req, res) => {
  res.json({ message: 'API работает 🚀' });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
