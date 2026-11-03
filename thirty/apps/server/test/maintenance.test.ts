import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('разовые обновления бота', () => {
  it('у каждого обновления свой ключ (повторный ключ молча пропускает обновление)', () => {
    const src = readFileSync(path.join(__dirname, '../src/modules/bot.ts'), 'utf8');
    const keys = [...src.matchAll(/'(maintenance\.[A-Za-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});
