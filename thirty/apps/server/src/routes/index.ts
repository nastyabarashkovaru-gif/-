import type { FastifyInstance } from 'fastify';
import { billingRoutes } from './billing';
import { socialRoutes } from './social';
import { adminRoutes } from './admin';
import { journeyRoutes } from './journey';

export async function registerExtraRoutes(app: FastifyInstance) {
  await app.register(billingRoutes);
  await app.register(socialRoutes);
  await app.register(adminRoutes);
  await app.register(journeyRoutes);
}
