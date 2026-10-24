import { Bell } from 'lucide-react';
import { Empty, Header, Screen } from '../../ui';

/** Центр уведомлений: макет ещё не утверждён — пока пустое состояние */
export function Notifications() {
  return (
    <Screen id="S_NOTIFY" nav>
      <Header title="Уведомления" back />
      <Empty icon={<Bell size={36} color="var(--accent)" />} title="Уведомлений пока нет" text="Здесь появятся напоминания об отчётах, ответы в чате и новости челленджа." />
    </Screen>
  );
}
