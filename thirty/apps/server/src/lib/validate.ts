import type { z, ZodTypeAny } from 'zod';
import { badRequest } from '../http';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('validation_error', 'Проверьте заполненные поля', r.error.flatten());
  return r.data;
}
