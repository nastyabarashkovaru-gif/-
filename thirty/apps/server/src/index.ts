import { buildApp } from './app';
import { clock } from './clock';
import { config } from './config';
import { prisma } from './db';
import { seed } from './seed';
import { startScheduler } from './jobs/scheduler';
import { setupBot } from './lib/botSetup';
import { setupAdminBot } from './modules/adminBot';
import { ensureDemoPhotos, restoreDemoClock } from './modules/demo';
import { checkCloudPaymentsKeys } from './payments/cloudpayments';

async function main() {
  // Только для локального просмотра экранов: «сейчас» = DEV_FAKE_NOW
  if (config.NODE_ENV !== 'production' && process.env.DEV_FAKE_NOW) clock.set(process.env.DEV_FAKE_NOW);
  await seed();
  const app = await buildApp({ logger: true });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  await setupBot();
  await setupAdminBot();
  if (process.env.CHAIN_TEST) {
    const { chainTestUsers } = await import('./modules/chainTest');
    console.log(`[chain-test] режим проверки цепочки включён для: ${[...(await chainTestUsers())].join(', ') || 'никого'}`);
  }
  if (config.DEMO_MODE) {
    await restoreDemoClock().catch((e) => console.warn('[demo] clock', e));
    await ensureDemoPhotos().catch((e) => console.warn('[demo] photos', e));
  }
  if (config.PAYMENT_PROVIDER === 'cloudpayments') await checkCloudPaymentsKeys();
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
