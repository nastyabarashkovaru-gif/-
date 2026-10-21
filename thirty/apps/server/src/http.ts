export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) => new HttpError(400, code, message, details);
export const forbidden = (code = 'forbidden', message?: string) => new HttpError(403, code, message);
export const notFound = (code = 'not_found', message?: string) => new HttpError(404, code, message);
export const conflict = (code: string, message?: string) => new HttpError(409, code, message);

/** BigInt → string в JSON-ответах */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
