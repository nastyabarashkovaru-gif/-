import type { Plan } from '../api/types';
import { Sheet } from '../ui/kit';

/** Черновик условий. Финальный юридический текст и реквизиты — решение владельца (см. docs/OWNER_DECISIONS.md). */
export function Legal({ open, onClose, plans }: { open: boolean; onClose: () => void; plans: Plan[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="Условия подписки">
      <div className="space-y-3 pb-4 text-[14px] leading-relaxed text-ink-soft">
        <p>Доступ к саду, задачам и всем функциям приложения предоставляется по подписке. Без подписки доступно только демонстрационное обучение.</p>
        {plans.map((p) => (
          <p key={p.id}><b className="text-ink">{p.title} — {p.priceStars} ⭐{p.displayPriceRub ? ` (≈ ${p.displayPriceRub} ₽)` : ''}.</b> {p.terms}</p>
        ))}
        <p>Оплата производится в Telegram Stars через Telegram. Ориентировочная цена в рублях зависит от курса покупки Stars в твоём приложении Telegram.</p>
        <p>Отмена: Профиль → Настройки → Управление подпиской. После отмены автопродление выключается, доступ сохраняется до конца оплаченного периода. Сад, уровни и история не удаляются и восстанавливаются после повторной оплаты.</p>
        <p>Возвраты рассматриваются через поддержку в соответствии с правилами Telegram для Stars.</p>
        <p className="text-[12px] text-ink-mute">Документ-черновик: перед запуском владелец дополняет его реквизитами и офертой.</p>
      </div>
    </Sheet>
  );
}
