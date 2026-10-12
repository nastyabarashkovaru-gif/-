import { SPHERES } from '@rostok/shared';
import { Island } from './Island';
import { Tree } from './Tree';

/** /art — витрина всех видов, уровней и состояний (для художника и проверки asset manifest). */
export default function ArtPreview() {
  const levels = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50];
  return (
    <div className="bg-white p-4">
      <h1 className="mb-1 text-xl font-bold">Деревья: виды × уровни × состояния</h1>
      <p className="mb-4 text-sm text-ink-mute">Процедурный временный арт. Финальные ассеты подключаются через asset manifest.</p>
      {SPHERES.map((s) => (
        <div key={s.id} className="mb-4">
          <div className="mb-1 text-sm font-semibold" style={{ color: s.ink }}>{s.name} · {s.speciesName}</div>
          <div className="flex flex-wrap items-end gap-1">
            {levels.map((l) => <div key={l} className="text-center text-[10px] text-ink-mute"><Tree species={s.species} level={l} size={92} />{l}</div>)}
            {s.id === 'health' && [5, 20].map((l) => <div key={`w${l}`} className="text-center text-[10px] text-ink-mute"><Tree species={s.species} level={l} withered size={92} />{l}·увяд.</div>)}
            <div className="text-center text-[10px] text-ink-mute"><div style={{ opacity: 0.16 }}><Tree species={s.species} level={12} silhouette size={92} /></div>силуэт</div>
          </div>
        </div>
      ))}
      <div className="max-w-md"><Island decor={['flowers', 'stones', 'pond', 'mushrooms', 'lanterns', 'bench', 'butterflies']} /></div>
    </div>
  );
}
