import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';
import { UserProfile } from '../../types';
import Avatar from '../../components/Avatar';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorAuth, setErrorAuth] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) {
      navigate('/admin/login');
      return;
    }
    adminApi
      .get<UserProfile[]>('/admin/users')
      .then(setUsers)
      .catch(() => setErrorAuth(true))
      .finally(() => setLoading(false));
  }, [navigate]);

  const logout = () => {
    localStorage.removeItem('admin_token');
    navigate('/admin/login');
  };

  if (errorAuth) {
    navigate('/admin/login');
    return null;
  }

  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}>
      <div className="screen">
        <div className="top-header">
          <h1>Админ-панель</h1>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px' }} onClick={logout}>
            Выйти
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Link to="/admin" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Участники
          </Link>
          <Link to="/admin/payments" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
            Платежи
          </Link>
        </div>

        {loading && <p>Загрузка…</p>}

        {!loading &&
          users.map((u) => (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="list-item">
              <Avatar url={u.photoUrl} name={u.firstName} />
              <div style={{ flex: 1 }}>
                <div className="name">{u.firstName || 'Участник'}</div>
                <div className="meta">
                  {u.username ? `@${u.username}` : ''} {u.city ? `· ${u.city}` : ''} · цена слова: {u.priceOfWord ?? '—'} ₽
                </div>
              </div>
              {u.goalConfirmedWinner && <span className="badge accent">Победитель</span>}
              {!u.onboardingCompleted && <span className="badge">Не заполнил анкету</span>}
            </Link>
          ))}
      </div>
    </div>
  );
}
