import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-change-me';

export function signAdminToken(): string {
  return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '30d' });
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, SECRET) as { role: string };
    if (payload.role !== 'admin') throw new Error('bad role');
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
