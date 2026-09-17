import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Рядом с базой данных (backend/data/uploads) — не зависит от того, запущен код через
// ts-node (src/) или собранным (dist/), и оба хранилища можно бэкапить/монтировать одним диском.
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/;

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (видео тренировки)
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) cb(null, true);
    else cb(new Error('unsupported_file_type'));
  },
});

export const uploadsPublicPath = '/uploads';
export const uploadsDirPath = uploadsDir;
