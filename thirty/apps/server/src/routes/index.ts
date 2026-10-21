import type { FastifyInstance } from 'fastify';
import { billingRoutes } from './billing';
import { socialRoutes } from './social';

export async function registerExtraRoutes(app: FastifyInstance) {
  await app.register(billingRoutes);
  await app.register(socialRoutes);
}
