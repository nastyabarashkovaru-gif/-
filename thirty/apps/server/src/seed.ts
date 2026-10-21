import { DEFAULT_TARIFFS } from '@thirty/domain';
import { prisma } from './db';
import { config } from './config';
import { seedTemplates } from './modules/bot';
import { hashPassword } from './auth/admin';

/** Начальные данные: тарифы ТЗ 1.1, шаблоны бота, первый администратор (owner). Идемпотентно. */
export async function seed() {
  for (const [i, t] of DEFAULT_TARIFFS.entries()) {
    await prisma.tariff.upsert({
      where: { id: t.id },
      create: {
        id: t.id, title: t.title, months: t.months, goalLimit: t.goalLimit, promoPrice: t.promoPrice, regularPrice: t.regularPrice,
        comparisonMonthPrice: t.comparisonMonthPrice, renewalPrice: t.renewalPrice, highlighted: t.highlighted, badge: t.badge, features: t.features, sort: i,
      },
      update: {},
    });
  }
  await seedTemplates();
  const upsells = [
    { code: 'blog_vip', title: 'Блог VIP', price: 15000, description: 'Личный разбор ваших роликов экспертом. Объём и сроки разбора уточняются до оплаты.', disclaimer: 'Без гарантий роста подписчиков и дохода.' },
    { code: 'personal', title: 'Персональное ведение', price: 120000, description: 'Индивидуальная работа с куратором в течение месяца.', disclaimer: 'Мы не гарантируем рост подписчиков или дохода.' },
    { code: 'partner', title: 'Партнёрское обучение', price: 10000, description: 'Обучение продвижению продукта клуба.', disclaimer: 'Без обещаний заработка.' },
  ];
  for (const [i, u] of upsells.entries()) await prisma.upsell.upsert({ where: { code: u.code }, create: { ...u, sort: i, active: false }, update: {} });
  if (config.ADMIN_BOOTSTRAP_LOGIN && config.ADMIN_BOOTSTRAP_PASSWORD) {
    const exists = await prisma.adminUser.findUnique({ where: { login: config.ADMIN_BOOTSTRAP_LOGIN } });
    if (!exists) await prisma.adminUser.create({ data: { login: config.ADMIN_BOOTSTRAP_LOGIN, passwordHash: await hashPassword(config.ADMIN_BOOTSTRAP_PASSWORD), role: 'owner' } });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => {
    console.log('seed ok');
    process.exit(0);
  });
}
