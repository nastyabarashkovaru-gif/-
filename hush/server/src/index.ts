import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { requireTelegram } from './auth';
import { billingApi, billingEnabled, cloudPaymentsWebhooks } from './billing';
import { config } from './config';
import { migrate, pool } from './db';
import { legal } from './legal';
import { api } from './routes';
import { handleUpdate, setupBot, webhookSecret } from './telegram';

async function main() {
  await migrate();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Уведомления CloudPayments — до JSON-парсера: подпись считается по сырому телу
  app.use('/api/billing/cloudpayments', cloudPaymentsWebhooks);
  app.use(express.json({ limit: '64kb' }));
  app.use('/legal', legal);

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  // Webhook бота: Telegram подписывает запросы секретом из setWebhook
  app.post('/api/telegram/webhook', (req, res) => {
    if (req.get('x-telegram-bot-api-secret-token') !== webhookSecret) {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(200);
    handleUpdate(req.body).catch((e) => console.error('[bot] update:', e));
  });

  // Всё остальное API — только с проверенной подписью Telegram initData
  app.use('/api/billing', requireTelegram, billingApi);
  app.use('/api', requireTelegram, api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'not_found' });
  });

  // Собранное приложение (hush/dist) на том же домене
  const dist = path.join(__dirname, '../../dist');
  if (existsSync(dist)) {
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, file) => {
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    console.warn('[server] hush/dist не найден — соберите приложение: npm run build');
  }

  app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}`);
    console.log(`[billing] CloudPayments: ${billingEnabled ? 'подключён' : 'не настроен (CP_PUBLIC_ID / CP_API_SECRET)'}`);
    void setupBot();
  });
}

main().catch((e) => {
  console.error('[server] не удалось запустить:', e);
  process.exit(1);
});
