import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import './db';

import usersRouter from './routes/users';
import progressRouter from './routes/progress';
import ratingRouter from './routes/rating';
import paymentsRouter from './routes/payments';
import adminRouter from './routes/admin';
import finaleRouter from './routes/finale';
import { uploadsDirPath, uploadsPublicPath } from './upload';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(uploadsPublicPath, express.static(uploadsDirPath));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/users', usersRouter);
app.use('/api/progress', progressRouter);
app.use('/api/rating', ratingRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/finale', finaleRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err?.message });
});

app.listen(PORT, () => {
  console.log(`100 дней спорта — backend запущен на порту ${PORT}`);
});
