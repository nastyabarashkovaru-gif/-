import { useState } from 'react';
import { Info, Trophy } from 'lucide-react';
import { api } from '../../lib/api';
import { Avatar, Empty, ErrorState, Header, Loading, Screen, Sheet, useLoad } from '../../ui';

interface Board {
  flow: { title: string } | null;
  rules: string;
  me: string;
  rows: { userId: string; name: string; photoUrl: string | null; rank: number; percent: number; successfulDays: number; missedReports: number; perfect: boolean }[];
}

/** S26: рейтинг потока — процент обязательств, успешные дни, правила, индикатор идеального выполнения */
export function Rating() {
  const { data, error, loading, reload } = useLoad(() => api<Board>('/api/leaderboard'));
  const [rules, setRules] = useState(false);
  const mine = data?.rows.find((r) => r.userId === data.me);
  return (
    <Screen id="S26" nav>
      <Header title="Рейтинг" sub={data?.flow ? `Поток «${data.flow.title}»` : undefined} right={<button className="icon-btn" aria-label="Правила" onClick={() => setRules(true)}><Info size={20} /></button>} />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : !data!.rows.length ? (
        <Empty icon={<Trophy size={40} />} title="Рейтинг появится со стартом потока" />
      ) : (
        <>
          {mine && (
            <div className="card peach">
              <div className="row between"><div><div className="label">Ты на месте</div><div className="big-num">#{mine.rank}</div></div><div className="badge-pct">{mine.percent}%</div></div>
              {mine.perfect ? <div className="pill green" style={{ alignSelf: 'flex-start' }}>Идеально: без пропусков</div> : <div className="muted small">Пропуск снижает процент, но путь продолжается</div>}
            </div>
          )}
          <div className="card">
            {data!.rows.map((r) => (
              <div className="list-item" key={r.userId} style={r.userId === data!.me ? { background: 'var(--orange-soft)', margin: '0 -12px', padding: '12px', borderRadius: 12 } : undefined}>
                <b style={{ width: 28, color: r.rank <= 3 ? 'var(--orange)' : 'var(--muted)' }}>{r.rank}</b>
                <Avatar name={r.name} url={r.photoUrl} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{r.name} {r.perfect && '✨'}</div><div className="muted small">{r.successfulDays} успешных дней</div></div>
                <b className="green">{r.percent}%</b>
              </div>
            ))}
          </div>
          <p className="muted small center">✨ — ни одного пропуска. Больше целей не даёт преимущества: считается процент обязательств.</p>
        </>
      )}
      <Sheet open={rules} onClose={() => setRules(false)}>
        <div className="h3">Правила рейтинга и приза</div>
        <p style={{ margin: 0 }}>{data?.rules}</p>
        <button className="btn btn-secondary" onClick={() => setRules(false)}>Понятно</button>
      </Sheet>
    </Screen>
  );
}
