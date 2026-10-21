import type { FastifyInstance } from 'fastify';
import { billingRoutes } from './billing';

export async function registerExtraRoutes(app: FastifyInstance) {
  await app.register(billingRoutes);
}
