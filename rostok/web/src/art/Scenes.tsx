import { SPHERES } from '@rostok/shared';
import { Island, TREE_SLOTS } from './Island';
import { Sprout, Tree } from './Tree';
import { IconGift } from './icons';

/** Иллюстрации продающих слайдов, собранные из тех же ассетов, что и сад. */
export function SlideArt({ art }: { art: string }) {
  if (art === 'lonely-sprout') {
    return (
      <div className="relative flex h-full items-end justify-center">
        <div className="absolute left-1/2 top-[18%] h-24 w-56 -translate-x-1/2 rounded-full bg-blush-soft blur-2xl" />
        <div className="relative mb-6 flex flex-col items-center">
          <Sprout size={150} sway />
          <div className="-mt-2 h-3 w-40 rounded-full bg-leaf-soft" />
        </div>
      </div>
    );
  }
  if (art === 'sprout-to-tree') {
    return (
      <div className="relative flex h-full items-end justify-center gap-1 pb-6">
        <div className="absolute left-1/2 top-[14%] h-28 w-64 -translate-x-1/2 rounded-full bg-leaf-soft blur-2xl" />
        <Sprout size={92} sway />
        <div className="mb-14 flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-blush" style={{ opacity: 0.4 + i * 0.3 }} />)}
        </div>
        <Tree species="lush" level={4} size={110} sway />
        <div className="mb-14 flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-blush" style={{ opacity: 0.4 + i * 0.3 }} />)}
        </div>
        <Tree species="lush" level={12} size={150} sway />
      </div>
    );
  }
  if (art === 'island-trees') {
    const levels = [9, 4, 14, 6, 11, 3];
    return <MiniGarden levels={levels} />;
  }
  return <GiftLineArt />;
}

export function MiniGarden({ levels, withered }: { levels: number[]; withered?: boolean }) {
  return (
    <div className="relative mx-auto mt-8 aspect-[400/300] w-full max-w-[340px]">
      <Island decor={['flowers', 'stones', 'pond']} className="absolute inset-0 h-full w-full" />
      {SPHERES.map((s, i) => {
        const slot = TREE_SLOTS[s.id];
        const w = 19 + Math.min(levels[i], 20) * 0.6;
        return (
          <div key={s.id} className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${w}%`, zIndex: Math.round(slot.y) }}>
            <Tree species={s.species} level={levels[i]} withered={withered && s.id === 'health'} size={200} className="h-auto w-full" sway />
          </div>
        );
      })}
    </div>
  );
}

function GiftLineArt() {
  const points = [{ n: 30, t: 'Новая книга' }, { n: 60, t: 'SPA' }, { n: 100, t: 'Путешествие' }];
  return (
    <div className="flex h-full flex-col items-center justify-end pb-4">
      <Tree species="sakura" level={10} size={150} sway />
      <div className="relative mt-4 w-full max-w-[320px] px-6">
        <div className="absolute left-6 right-6 top-[38px] h-[3px] rounded-full bg-leaf-soft" />
        <div className="absolute left-6 top-[38px] h-[3px] w-[40%] rounded-full bg-leaf" />
        <div className="relative flex justify-between">
          {points.map((p, i) => (
            <div key={p.n} className="flex w-20 flex-col items-center">
              <div className={`grid h-9 w-9 place-items-center rounded-full ${i === 0 ? 'bg-blush-accent text-white' : 'bg-blush-soft text-blush-ink'} shadow-soft`}>
                <IconGift size={18} />
              </div>
              <div className="mt-[10px] h-3 w-3 rounded-full border-2 border-white bg-leaf shadow" />
              <div className="mt-1.5 text-[13px] font-semibold text-ink">{p.n}</div>
              <div className="text-center text-[11px] leading-tight text-ink-mute">{p.t}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
