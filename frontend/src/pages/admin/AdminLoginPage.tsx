import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/client';

export default function AdminLoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await adminApi.post<{ token: string }>('/admin/login', { login, password });
      localStorage.setItem('admin_token', res.token);
      navigate('/admin');
    } catch {
      setError('Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="card" style={{ width: '100%', maxWidth: 360 }}>
        <h1>Админ-панель</h1>
        <p>100 дней спорта</p>

        <div className="field">
          <label>Логин</label>
          <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" onClick={submit} disabled={loading}>
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </div>
    </div>
  );
}
