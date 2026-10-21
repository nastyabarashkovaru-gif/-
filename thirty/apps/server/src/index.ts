import { buildApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { seed } from './seed';
import { startScheduler } from './jobs/scheduler';
import { setupBot } from './lib/botSetup';

async function main() {
  await seed();
  const app = await buildApp({ logger: true });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  await setupBot();
  if (config.SCHEDULER) startScheduler();
  const stop = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
