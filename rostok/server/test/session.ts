import { randomBytes } from 'node:crypto';
import { pool } from '../src/db.js';
import { hashToken } from '../src/auth.js';
export async function createSessionForTest(userId: number) {
  const token = randomBytes(24).toString('base64url');
  await pool.query(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2, now() + interval '1 day')`, [hashToken(token), userId]);
  return token;
}
