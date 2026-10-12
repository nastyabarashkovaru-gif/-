export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
export const notFound = (what = 'Не найдено') => new AppError(404, 'not_found', what);
export const badRequest = (msg: string, code = 'bad_request', extra = {}) => new AppError(400, code, msg, extra);
export const conflict = (msg: string, code: string, extra = {}) => new AppError(409, code, msg, extra);
