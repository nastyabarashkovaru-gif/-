import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { UserProfile } from '../types';
import Avatar from '../components/Avatar';

export default function ParticipantsPage() {
  const [participants, setParticipants] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (q: string) => {
    setLoading(true);
    try {
      const data = await api.get<UserProfile[]>(`/users${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      setParticipants(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="screen">
      <h1>Участники</h1>
      <input className="search-input" placeholder="Поиск по нику…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {loading && <p>Загрузка…</p>}
      {!loading && participants.length === 0 && <p>Никого не найдено.</p>}

      {participants.map((p) => (
        <Link key={p.id} to={`/participants/${p.id}`} className="list-item">
          <Avatar url={p.photoUrl} name={p.firstName} />
          <div>
            <div className="name">{p.firstName || 'Участник'}</div>
            <div className="meta">{p.username ? `@${p.username}` : ''} {p.city ? `· ${p.city}` : ''}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
