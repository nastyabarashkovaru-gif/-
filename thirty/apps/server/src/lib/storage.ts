import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';

export interface Storage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error('bad key');
    return path.resolve(this.dir, key);
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
  async get(key: string) {
    return readFile(this.file(key));
  }
}

class S3Storage implements Storage {
  private s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  async put(key: string, body: Buffer, mime: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

export const storage: Storage = config.S3_BUCKET ? new S3Storage() : new LocalStorage(config.UPLOAD_DIR);

export function newKey(ext: string) {
  const d = new Date().toISOString().slice(0, 7);
  return `media/${d}/${randomUUID()}.${ext}`;
}

/** Короткоживущая подписанная ссылка на медиа — файлы не лежат в публичном доступе */
export function signedMediaUrl(id: string, ttlSec = 3600, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`${id}.${exp}`).digest('hex').slice(0, 32);
  return `/api/media/${id}?exp=${exp}&sig=${sig}`;
}

export function verifyMediaSig(id: string, exp: string, sig: string, now = Date.now()): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
  const expected = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`${id}.${exp}`).digest('hex').slice(0, 32);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/** Проверка сигнатуры файла, а не только заявленного MIME */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp' && /hei|mif|heix/.test(buf.subarray(8, 12).toString('ascii'))) return 'image/heic';
  return null;
}
