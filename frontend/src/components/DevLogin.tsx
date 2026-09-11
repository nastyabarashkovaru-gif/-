import { useState } from 'react';
import { setDevUserId } from '../api/client';

// Виден только вне Telegram (например, при локальной разработке в обычном браузере).
export default function DevLogin() {
  const [id, setId] = useState('1');

  if (window.Telegram?.WebApp?.initData) return null;

  return (
    <div className="card" style={{ marginTop: 20, width: '100%', maxWidth: 320 }}>
      <p>Режим разработки: войти под тестовым Telegram ID</p>
      <div className="field">
        <input type="number" value={id} onChange={(e) => setId(e.target.value)} />
      </div>
      <button
        className="btn btn-primary"
        onClick={() => {
          setDevUserId(id);
          window.location.reload();
        }}
      >
        Войти как тестовый пользователь
      </button>
    </div>
  );
}
