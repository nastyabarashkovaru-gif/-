import { useState } from 'react';
import { SPHERES, type SphereId } from '@rostok/shared';
import { Tree } from '../art/Tree';
import { SphereIcon } from '../art/icons';
import { api } from '../api/client';
import { useApp } from '../state/app';
import { Button } from '../ui/kit';
import { TaskWizard } from './TaskWizard';

const IDEAS: Record<SphereId, string> = {
  relationships: 'Позвонить близкому человеку',
  savings: 'Отложить 500 ₽',
  work: 'Час работы без отвлечений',
  creativity: '15 минут рисования',
  health: 'Прогулка 30 минут',
  study: 'Урок английского',
};

/** После оплаты: создание первой настоящей задачи. Подсказки — по выбранным сферам. */
export function FirstTask({ onDone }: { onDone: () => void }) {
  const { me } = useApp();
  const [wizard, setWizard] = useState<SphereId | null | false>(false);
  const picked = me.settings.selectedSpheres.length ? me.settings.selectedSpheres : (['health', 'work', 'relationships'] as SphereId[]);
  const finish = async () => {
    await api('POST', '/onboarding', { step: 'done' }).catch(() => {});
    onDone();
  };
  return (
    <div className="fixed inset-0 overflow-y-auto bg-white pt-safe pb-safe">
      <div className="mx-auto max-w-[520px] px-5">
        <div className="mx-auto mt-4 w-[120px]"><Tree species="lush" level={1} size={200} className="h-auto w-full" sway /></div>
        <h1 className="mt-3 text-center text-[26px] font-bold leading-tight">Сад открыт! 🌱</h1>
        <p className="mt-2 text-center text-[15px] leading-relaxed text-ink-soft">Теперь всё по-настоящему. Создай первую задачу — капли за неё получит дерево её сферы.</p>
        <div className="mt-6 space-y-2.5">
          {picked.map((id) => {
            const s = SPHERES.find((x) => x.id === id)!;
            return (
              <button key={id} onClick={() => setWizard(id)} className="flex w-full items-center gap-3 rounded-[20px] bg-white p-4 text-left shadow-card ring-1 ring-ink-line active:bg-cream">
                <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: s.tint, color: s.ink }}><SphereIcon sphere={id} size={20} /></span>
                <span className="flex-1"><span className="block text-[13px] font-semibold" style={{ color: s.ink }}>{s.name}</span><span className="block text-[16px] font-medium">{IDEAS[id]}</span></span>
                <span className="text-[14px] font-semibold text-leaf-deep">Создать</span>
              </button>
            );
          })}
        </div>
        <Button className="mt-6 w-full" onClick={() => setWizard(null)}>Своя задача</Button>
        <Button variant="ghost" className="mt-1 w-full" onClick={finish}>Позже, сначала посмотрю сад</Button>
      </div>
      <TaskWizard open={wizard !== false} onClose={() => setWizard(false)} presetSphere={wizard || null} onSaved={finish} />
    </div>
  );
}
