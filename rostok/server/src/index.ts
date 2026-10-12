import { assertSafeConfig, config } from './config.js';
import { migrate } from './db.js';
import { seed } from './seed.js';
import { buildApp } from './app.js';
import { setupBot } from './telegram.js';
import { startWorker } from './worker.js';
import { bootstrapAdmin } from './admin/admin.js';

async function main() {
  assertSafeConfig();
  await migrate();
  await seed();
  await bootstrapAdmin();
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[rostok] ${config.appEnv} on :${config.port}, payments=${config.paymentProvider}, public=${config.publicUrl}`);
  await setupBot();
  if (config.workerEnabled) startWorker();
}

main().catch((e) => {
  console.error('[rostok] fatal:', e);
  process.exit(1);
});
