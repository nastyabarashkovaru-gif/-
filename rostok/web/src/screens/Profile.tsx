import { useEffect, useState } from 'react';
import { SPHERES, daysLabel } from '@rostok/shared';
import { Tree } from '../art/Tree';
import { IconChevron, IconSettings, IconSupport } from '../art/icons';
import { api } from '../api/client';
import type { Stats } from '../api/types';
import { useApp } from '../state/app';
import { Card } from '../ui/kit';
import { fmtDate, userName } from '../lib/format';
import { openTelegramLink, tgUserPhoto } from '../lib/telegram';
import { Settings } from './Settings';

export function ProfileScreen() {
  const { me, config, garden } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<false | 'main' | 'subscription'>(false);
  const [about, setAbout] = useState(false);
  useEffect(() => { api<Stats>('GET', '/stats').then(setStats).catch(() => {}); }, [garden]);
  const photo = me.user.photoUrl || tgUserPhoto();
  const maxDone = Math.max(1, ...(stats?.spheres.map((s) => s.completions) ?? [1]));
  const sub = me.subscription;
  return (
    <div className="mx-auto max-w-[560px] px-4 pt-safe pb-nav">
      <div className="flex items-center gap-4 pt-2">
        {photo ? <img src={photo} alt="" className="h-16 w-16 rounded-full object-cover ring-4 ring-leaf-soft" /> : (
          <div className="grid h-16 w-16 place-items-center rounded-full bg-leaf-soft text-[26px] font-bold text-leaf-deep" aria-hidden="true">{userName(me.user.firstName).slice(0, 1)}</div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold">{userName(me.user.firstName)}</h1>
          <p className="text-[14px] text-ink-mute">Мой сад растёт уже {daysLabel(stats?.gardenAgeDays ?? me.user.gardenAgeDays)}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Metric value={stats?.completionsTotal} label="Выполнено задач всего" />
        <Metric value={stats?.treesCount ?? 6} label="Деревьев" />
        <Metric value={stats ? `${stats.rewardsClaimed} из ${stats.rewardsTotal}` : undefined} label="Получено подарков" />
        <Metric value={stats?.gardenLevel} label="Текущий уровень сада" />
      </div>

      <h2 className="mt-7 text-[18px] font-bold">Сферы</h2>
      <Card className="mt-2 divide-y divide-ink-line px-4">
        {SPHERES.map((s) => {
          const st = stats?.spheres.find((x) => x.sphere === s.id);
          const lvl = st?.level ?? garden?.trees.find((t) => t.sphere === s.id)?.level ?? 1;
          return (
            <div key={s.id} className="flex items-center gap-3 py-3">
              <div className="w-11 shrink-0"><Tree species={s.species} level={lvl} size={200} className="h-auto w-full" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold" style={{ color: s.ink }}>{s.name}</span>
                  <span className="text-[13px] text-ink-mute">Ур. {lvl} · {st?.completions ?? 0} вып.</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream">
                  <div className="h-full rounded-full" style={{ width: `${((st?.completions ?? 0) / maxDone) * 100}%`, background: s.ink, opacity: 0.55 }} />
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="mt-5 divide-y divide-ink-line">
        <Row icon={<IconSupport size={20} />} label="Поддержка" onClick={() => config.supportUsername ? openTelegramLink(`https://t.me/${config.supportUsername}`) : setAbout(true)} />
        <Row icon={<IconSettings size={20} />} label="Настройки" onClick={() => setSettings('main')} />
      </Card>

      <div className="mt-6 space-y-1 text-center text-[12px] text-ink-mute">
        <button className="underline-offset-2 hover:underline" onClick={() => setSettings('subscription')}>
          {sub.access ? `${sub.plan?.title ?? 'Подписка'} · ${sub.status === 'cancel_at_period_end' ? 'доступ до' : sub.autoRenew ? 'продление' : 'до'} ${fmtDate(sub.accessUntil)}` : 'Подписка не активна'}
          {sub.isSandbox && ' · песочница'}
        </button>
        <div><button className="hover:underline" onClick={() => setAbout(true)}>О приложении</button></div>
      </div>
      <Settings open={settings} onClose={() => setSettings(false)} />
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}

function Metric({ value, label }: { value: number | string | undefined; label: string }) {
  return (
    <Card className="p-4">
      {value === undefined ? <div className="skeleton h-7 w-12 rounded-lg" /> : <div className="text-[24px] font-bold tabular-nums text-leaf-deep">{value}</div>}
      <div className="mt-0.5 text-[13px] leading-snug text-ink-mute">{label}</div>
    </Card>
  );
}

function Row({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-cream">
      <span className="text-leaf-deep">{icon}</span>
      <span className="flex-1 text-[16px] font-medium">{label}</span>
      <IconChevron size={18} className="text-ink-faint" />
    </button>
  );
}

import { Sheet } from '../ui/kit';
function About({ onClose }: { onClose: () => void }) {
  const { config } = useApp();
  return (
    <Sheet open onClose={onClose} title={`О приложении ${config.brand.appName}`}>
      <p className="text-[15px] leading-relaxed text-ink-soft">{config.brand.slogan}.</p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">Выполни задачу → получи капли своей сферы → накопи → полей дерево → открой сюрприз. Капли не покупаются и не переводятся между деревьями.</p>
      <p className="mt-3 pb-4 text-[13px] text-ink-mute">
        {config.supportUsername ? <>Поддержка: @{config.supportUsername}</> : 'Поддержка: напиши боту команду /support.'}
        <br />Иллюстрации деревьев — временные (процедурный арт), финальные 3D-ассеты подключаются через asset manifest.
      </p>
    </Sheet>
  );
}
