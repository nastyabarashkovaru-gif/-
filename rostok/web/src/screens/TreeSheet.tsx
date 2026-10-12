import { useEffect, useRef, useState } from 'react';
import { sphereById, dropsLabel, completionsLabel, type SphereId } from '@rostok/shared';
import { Drop, IconGift } from '../art/icons';
import { ApiError, api, uuid } from '../api/client';
import type { TreeState } from '../api/types';
import { useApp } from '../state/app';
import { Button, Sheet, useToast } from '../ui/kit';
import { TaskRow } from '../ui/tasks';
import { NextSilhouette, WateringScene } from '../ui/Watering';
import { TaskDetail } from './TaskDetail';

/** Карточка дерева: иллюстрация, уровень, запас воды, «Полить», задачи сферы, ближайший подарок, силуэт следующего. */
export function TreeSheet({ sphere, onClose }: { sphere: SphereId | null; onClose: () => void }) {
  const { garden, tasks, setGarden, refreshGarden, reducedMotion } = useApp();
  const toast = useToast();
  const [anim, setAnim] = useState<{ from: number; to: number } | null>(null);
  const [lack, setLack] = useState<{ need: number; cost: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState<any>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const key = useRef<string>('');
  const tree = garden?.trees.find((t) => t.sphere === sphere) ?? null;
  const s = sphere ? sphereById(sphere)! : null;

  useEffect(() => {
    if (!sphere) return;
    setAnim(null);
    setLack(null);
    api<{ nextGift: any }>('GET', `/trees/${sphere}`).then((r) => setGift(r.nextGift)).catch(() => setGift(null));
  }, [sphere]);

  const water = async () => {
    if (!tree || busy || anim) return;
    if (tree.availableDrops < tree.nextCost) {
      setLack({ need: tree.nextCost - tree.availableDrops, cost: tree.nextCost });
      return;
    }
    setBusy(true);
    key.current = key.current || uuid();
    try {
      const r = await api<{ duplicate: boolean; tree: TreeState; newDecor: string[] }>('POST', `/trees/${tree.sphere}/water`, { expectedLevel: tree.level }, { 'Idempotency-Key': key.current });
      key.current = '';
      if (r.duplicate) { await refreshGarden(); return; }
      setAnim({ from: tree.level, to: r.tree.level });
      setTimeout(() => {
        setGarden((g) => ({ ...g, trees: g.trees.map((t) => (t.sphere === r.tree.sphere ? r.tree : t)) }));
        refreshGarden().catch(() => {});
        if (r.newDecor.length) toast('На острове появилось что-то новое ✨', 'ok');
      }, reducedMotion ? 800 : 2600);
    } catch (e) {
      key.current = '';
      if (e instanceof ApiError && e.code === 'not_enough_drops') setLack({ need: e.data.need, cost: e.data.cost });
      else toast(e instanceof ApiError ? e.message : 'Не получилось полить', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sphereTasks = (tasks ?? []).filter((t) => t.sphere === sphere && t.status === 'active');
  return (
    <Sheet open={!!sphere} onClose={onClose} tall>
      {tree && s && (
        <div>
          <div className="text-center">
            <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: s.ink }}>{s.speciesName}</div>
            <h2 className="text-[24px] font-bold">{s.name}</h2>
          </div>
          <div className="relative mt-2">
            <WateringScene species={s.species} fromLevel={anim?.from ?? tree.level} toLevel={anim?.to ?? tree.level} withered={tree.healthVisualState === 'withered'}
              size={210} reduced={reducedMotion} playing={!!anim} onDone={() => setTimeout(() => setAnim(null), 900)} />
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <span className="rounded-full bg-leaf-soft px-3 py-1 text-[14px] font-bold text-leaf-deep">Ур. {anim?.to ?? tree.level}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-drop-soft px-3 py-1 text-[15px] font-bold text-[#1F6F96]" aria-label={`Запас воды: ${dropsLabel(tree.availableDrops)}`}>
              <Drop size={16} /> {tree.availableDrops}
            </span>
          </div>
          {tree.healthVisualState === 'withered' && (
            <p className="mx-auto mt-3 max-w-[340px] rounded-2xl bg-cream px-4 py-2.5 text-center text-[13px] text-ink-soft">
              Дерево загрустило из-за вредной привычки. Три дня подряд с ответом «Нет» — и оно снова зазеленеет. Уровень и капли на месте.
            </p>
          )}
          <Button className="mt-4 w-full" onClick={water} loading={busy} disabled={!!anim}>
            Полить · {tree.nextCost} 💧
          </Button>
          {lack && (
            <div className="mt-3 rounded-2xl bg-drop-soft p-4 text-center" role="alert">
              <div className="text-[16px] font-semibold text-ink">Для следующего полива нужно ещё {dropsLabel(lack.need)}</div>
              <div className="mt-1 text-[13px] text-ink-soft">Полив до уровня {tree.level + 1} стоит {dropsLabel(lack.cost)}. Капли приходят за выполненные задачи сферы «{s.name}».</div>
            </div>
          )}
          {!anim && <div className="mt-5 flex justify-center"><NextSilhouette species={s.species} level={tree.level + 1} size={58} /></div>}

          {gift && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-blush-soft p-3.5">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-blush-accent"><IconGift size={20} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{gift.title}</div>
                <div className="text-[12px] text-ink-soft">«{gift.task_title}»: {gift.completions_count} из {completionsLabel(gift.threshold)}</div>
              </div>
            </div>
          )}

          <h3 className="mt-6 text-[17px] font-bold">Задачи сферы</h3>
          <div className="mt-2 space-y-2.5 pb-2">
            {sphereTasks.length === 0 && <p className="text-[14px] text-ink-mute">Пока нет задач. Создай задачу во вкладке «Задачи» — капли за неё придут этому дереву.</p>}
            {sphereTasks.map((t) => <TaskRow key={t.id} task={t} showLine={false} onOpen={(x) => setDetail(x.id)} />)}
          </div>
        </div>
      )}
      <TaskDetail taskId={detail} onClose={() => setDetail(null)} />
    </Sheet>
  );
}
