import { Hammer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { AppHeader, Screen, SecondaryButton } from '@/components/ui';
import { useBack } from '@/lib/useBack';

/**
 * Временная заглушка прототипа для экранов следующих этапов.
 * Оформлена как служебная, чтобы не путать с финальным интерфейсом.
 */
const UPCOMING: Record<string, { title: string; stage: string }> = {
  settings: { title: 'Настройки', stage: 'Этап 4' },
  builder: { title: 'Конструктор анкеты', stage: 'Этап 4' },
  upsell: { title: '«Хочешь узнать о себе ещё больше?»', stage: 'Этап 4' },
  answer: { title: 'Заполнение анкеты другом', stage: 'Этап 3' },
};

export function UpcomingScreen() {
  const { id = '' } = useParams();
  const back = useBack('/home');
  const info = UPCOMING[id] ?? { title: 'Экран', stage: 'следующий этап' };

  return (
    <Screen>
      <AppHeader onBack={back} showLogo={false} />
      <div className="px-gutter pt-6">
        <div className="rounded-card border border-dashed border-[#3A3C48] p-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface2 text-muted">
            <Hammer size={20} />
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[#71717A]">Прототип · {info.stage}</p>
          <h1 className="mt-2 text-[18px] font-semibold leading-6">{info.title}</h1>
          <p className="mt-2 text-[14px] leading-5 text-muted">Этот экран разработаем после утверждения текущего этапа.</p>
          <SecondaryButton className="mt-5" onClick={back}>
            Вернуться
          </SecondaryButton>
        </div>
      </div>
    </Screen>
  );
}
