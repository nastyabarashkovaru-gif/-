import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn', 'error'] });
export { Prisma };

export type Tx = Prisma.TransactionClient;

/** Ошибка уникальности Prisma — признак идемпотентного повтора или гонки */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Сериализуемая транзакция с повтором при конфликте */
export async function serializable<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      const retryable = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2002');
      if (!retryable || attempt >= retries) throw e;
    }
  }
}
