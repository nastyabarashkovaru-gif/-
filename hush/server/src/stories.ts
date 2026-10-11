/**
 * Картинки для сторис: Telegram (shareToStory, downloadFile) принимает только ссылку,
 * поэтому PNG ненадолго хранится в памяти сервера и отдаётся по случайному адресу.
 */
import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import { config } from './config';
import { rateLimit } from './rateLimit';

const TTL_MS = 2 * 60 * 60_000;
const MAX_ITEMS = 500;
const MAX_BYTES = 4 * 1024 * 1024;
const store = new Map<string, { png: Buffer; expires: number }>();

function cleanup() {
  const now = Date.now();
  for (const [id, item] of store) if (item.expires < now) store.delete(id);
  while (store.size > MAX_ITEMS) store.delete(store.keys().next().value!);
}

/** POST /api/stories { image: "data:image/png;base64,..." } → { url } (с авторизацией Telegram) */
export const storiesApi = Router();
storiesApi.use(express.json({ limit: '6mb' }));
storiesApi.post('/', rateLimit('stories', 60, 60 * 60_000), (req, res) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ''));
  const png = match ? Buffer.from(match[1], 'base64') : null;
  // Проверяем сигнатуру PNG и размер
  if (!png || png.length > MAX_BYTES || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    res.status(400).json({ code: 'invalid' });
    return;
  }
  cleanup();
  const id = randomBytes(16).toString('hex');
  store.set(id, { png, expires: Date.now() + TTL_MS });
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/s/${id}.png` });
});

/** GET /s/:id.png — публично, ссылка случайная и живёт 2 часа */
export const storiesPublic = Router();
storiesPublic.get('/:id.png', (req, res) => {
  const item = store.get(req.params.id);
  if (!item || item.expires < Date.now()) {
    res.sendStatus(404);
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=7200');
  res.setHeader('Content-Disposition', 'inline; filename="hush-story.png"');
  res.send(item.png);
});
