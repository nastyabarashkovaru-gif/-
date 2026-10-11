import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Question {
  id: string;
  text: string;
  custom?: boolean;
  /** Расширенная библиотека — только по подписке */
  premium?: boolean;
}

/** Общий каталог вопросов с приложением: hush/shared/questions.json */
const file = path.join(__dirname, '../../shared/questions.json');
export const CATALOG: Question[] = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(CATALOG.map((q) => [q.id, q]));

export const catalogQuestion = (id: string): Question | undefined => byId.get(id);
