import type { NextFunction, Request, Response } from 'express';

/** Простой лимит запросов в памяти по Telegram ID (на один инстанс сервера) */
export function rateLimit(name: string, max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.user?.id ?? req.ip}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.status(429).json({ code: 'rate_limited' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 50_000) hits.clear();
    next();
  };
}
