import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { RatingEntry } from '../types';
import Avatar from '../components/Avatar';

export default function RatingPage() {
  const [tab, setTab] = useState<'overall' | 'monthly'>('overall');
  const [entries, setEntries] = useState<RatingEntry[]>([]);
  const [prizeFund, setPrizeFund] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<RatingEntry[]>(`/rating/${tab}`)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    api.get<{ total: number }>('/rating/prize-fund').then((r) => setPrizeFund(r.total));
  }, []);

  return (
    <div className="screen">
      <h1>Рейтинг</h1>

      <div className="card" style={{ textAlign: 'center' }}>
        <div className="badge accent" style={{ marginBottom: 8 }}>
          Призовой фонд
        </div>
        <h2 style={{ fontSize: 30 }}>{prizeFund !== null ? `${prizeFund.toLocaleString('ru-RU')} ₽` : '…'}</h2>
        <p style={{ marginTop: 6 }}>Победителя определяют организаторы вручную — на основе рейтинга и реального достижения цели.</p>
      </div>

      <div className="tabs">
        <button className={tab === 'overall' ? 'active' : ''} onClick={() => setTab('overall')}>
          Общий (100 дней)
        </button>
        <button className={tab === 'monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>
          Текущий месяц
        </button>
      </div>

      {loading && <p>Загрузка…</p>}

      {!loading &&
        entries.map((e) => (
          <Link key={e.userId} to={`/participants/${e.userId}`} className="list-item">
            <div className="rank-badge">{e.place}</div>
            <Avatar url={e.photoUrl} name={e.firstName} />
            <div>
              <div className="name">{e.firstName || 'Участник'}</div>
              <div className="meta">
                {e.username ? `@${e.username}` : ''} · {e.trainingDays} тренировочных дней
              </div>
            </div>
          </Link>
        ))}
    </div>
  );
}
