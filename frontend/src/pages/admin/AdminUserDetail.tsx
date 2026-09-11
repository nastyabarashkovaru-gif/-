import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { UserProfile, DayReport } from '../../types';
import Avatar from '../../components/Avatar';

type AdminUserDetailData = UserProfile & { reports: DayReport[] };

export default function AdminUserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminUserDetailData | null>(null);
  const [manualRank, setManualRank] = useState('');
  const [confirmedWinner, setConfirmedWinner] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    adminApi.get<AdminUserDetailData>(`/admin/users/${id}`).then((d) => {
      setData(d);
      setManualRank(d.manualRank?.toString() || '');
      setConfirmedWinner(d.goalConfirmedWinner);
    });
  };

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) {
      navigate('/admin/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.put(`/admin/users/${id}/rating`, {
        manualRank: manualRank ? Number(manualRank) : null,
        goalConfirmedWinner: confirmedWinner,
      });
      load();
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <div className="screen">Загрузка…</div>;

  const completedDays = data.reports.filter((r) => r.trainingDone).length;

  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}>
      <div className="screen">
        <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px', marginBottom: 16 }} onClick={() => navigate('/admin')}>
          ← К списку
        </button>

        <div className="top-header" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <Avatar url={data.photoUrl} name={data.firstName} size="lg" />
          <h1 style={{ marginTop: 12 }}>{data.firstName}</h1>
          {data.username && <p>@{data.username}</p>}
        </div>

        <div className="card">
          <h3>Анкета</h3>
          <p>Возраст: {data.age ?? '—'}</p>
          <p>Город: {data.city || '—'}</p>
          <p>Цель: {data.goal || '—'}</p>
          <p>Цена слова: {data.priceOfWord ?? '—'} ₽</p>
          <p>Форс-мажор: {data.forceMajeureAllowed}</p>
          {data.beforePhoto && <img className="preview" src={data.beforePhoto} alt="до" />}
          {data.beforeDescription && <p style={{ marginTop: 8 }}>{data.beforeDescription}</p>}
          {data.measurements && <p>Замеры: {data.measurements}</p>}
        </div>

        <div className="card">
          <h3>Прогресс</h3>
          <p>Выполнено тренировок: {completedDays} из {data.reports.length}</p>
        </div>

        <div className="card">
          <h3>Управление рейтингом</h3>
          <div className="field">
            <label>Ручной ранг (место в рейтинге)</label>
            <input type="number" value={manualRank} onChange={(e) => setManualRank(e.target.value)} placeholder="Оставь пустым для авторасчёта" />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={confirmedWinner} onChange={(e) => setConfirmedWinner(e.target.checked)} />
            <span className="label">Подтвердить как победителя (после ручной проверки цели)</span>
          </label>
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 10 }}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>

        <div className="card">
          <h3>Отчёты по дням</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
            {data.reports.map((r) => (
              <div
                key={r.dayNumber}
                title={`День ${r.dayNumber}`}
                style={{
                  aspectRatio: '1',
                  borderRadius: 6,
                  background: r.trainingDone ? 'var(--accent)' : 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  fontSize: 9,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: r.trainingDone ? '#0a0a0a' : 'var(--text-dim)',
                  fontWeight: 800,
                }}
              >
                {r.dayNumber}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
