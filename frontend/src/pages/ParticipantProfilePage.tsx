import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { UserProfile } from '../types';
import Avatar from '../components/Avatar';

export default function ParticipantProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    api.get<UserProfile>(`/users/${id}`).then(setProfile);
  }, [id]);

  if (!profile) return <div className="screen">Загрузка…</div>;

  return (
    <div className="screen">
      <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px', marginBottom: 16 }} onClick={() => navigate(-1)}>
        ← Назад
      </button>

      <div className="top-header" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Avatar url={profile.photoUrl} name={profile.firstName} size="lg" />
        <h1 style={{ marginTop: 12 }}>{profile.firstName || 'Участник'}</h1>
        {profile.username && <p>@{profile.username}</p>}
      </div>

      <div className="card">
        <h3>Данные</h3>
        <p>Возраст: {profile.age ?? '—'}</p>
        <p>Город: {profile.city || '—'}</p>
      </div>

      <div className="card">
        <h3>Цель</h3>
        <p>{profile.goal || '—'}</p>
      </div>

      {profile.beforePhoto && (
        <div className="card">
          <h3>«До»</h3>
          <img className="preview" src={profile.beforePhoto} alt="до" />
          {profile.beforeDescription && <p style={{ marginTop: 10 }}>{profile.beforeDescription}</p>}
        </div>
      )}

      {profile.measurements && (
        <div className="card">
          <h3>Замеры</h3>
          <p>{profile.measurements}</p>
        </div>
      )}

      <div className="card">
        <h3>Ежедневные задачи</h3>
        <div className="checkbox-row mandatory">
          <input type="checkbox" checked readOnly />
          <span className="label">
            Ежедневная тренировка <span className="star">★</span>
          </span>
        </div>
        {profile.extraTasks.map((t) => (
          <div className="checkbox-row" key={t.id}>
            <input type="checkbox" checked readOnly />
            <span className="label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
