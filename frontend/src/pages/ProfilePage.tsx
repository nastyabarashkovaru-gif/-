import { useState } from 'react';
import { useUser } from '../context/UserContext';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import PhotoUpload from '../components/PhotoUpload';
import { UserProfile } from '../types';

export default function ProfilePage() {
  const { user, refresh } = useUser();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [age, setAge] = useState(user?.age?.toString() || '');
  const [city, setCity] = useState(user?.city || '');
  const [goal, setGoal] = useState(user?.goal || '');
  const [beforePhoto, setBeforePhoto] = useState<string | null>(user?.beforePhoto || null);
  const [beforeDescription, setBeforeDescription] = useState(user?.beforeDescription || '');
  const [measurements, setMeasurements] = useState(user?.measurements || '');
  const [priceOfWord, setPriceOfWord] = useState(user?.priceOfWord?.toString() || '');
  const [forceMajeure, setForceMajeure] = useState(user?.forceMajeureAllowed?.toString() || '0');

  if (!user) return null;

  const startEdit = () => {
    setAge(user.age?.toString() || '');
    setCity(user.city || '');
    setGoal(user.goal || '');
    setBeforePhoto(user.beforePhoto);
    setBeforeDescription(user.beforeDescription || '');
    setMeasurements(user.measurements || '');
    setPriceOfWord(user.priceOfWord?.toString() || '');
    setForceMajeure(user.forceMajeureAllowed?.toString() || '0');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put<UserProfile>('/users/me', {
        age: age ? Number(age) : undefined,
        city: city || undefined,
        goal: goal || undefined,
        beforePhoto: beforePhoto || undefined,
        beforeDescription: beforeDescription || undefined,
        measurements: measurements || undefined,
        priceOfWord: priceOfWord ? Number(priceOfWord) : undefined,
        forceMajeureAllowed: forceMajeure ? Number(forceMajeure) : undefined,
      });
      await refresh();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="screen">
        <h1>Редактирование анкеты</h1>

        <div className="field">
          <label>Возраст</label>
          <input type="number" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="field">
          <label>Город</label>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label>Цель</label>
          <textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </div>
        <div className="field">
          <label>«До»: фото</label>
          <PhotoUpload value={beforePhoto} onChange={(url) => setBeforePhoto(url)} accept="image/*" />
        </div>
        <div className="field">
          <label>«До»: описание</label>
          <textarea rows={2} value={beforeDescription} onChange={(e) => setBeforeDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Замеры</label>
          <textarea rows={2} value={measurements} onChange={(e) => setMeasurements(e.target.value)} />
        </div>
        <div className="field">
          <label>Цена слова, ₽</label>
          <input type="number" value={priceOfWord} onChange={(e) => setPriceOfWord(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div className="field">
          <label>Форс-мажор (жизни)</label>
          <input type="number" value={forceMajeure} onChange={(e) => setForceMajeure(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>

        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginBottom: 10 }}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="top-header" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Avatar url={user.photoUrl} name={user.firstName} size="lg" />
        <h1 style={{ marginTop: 12 }}>{user.firstName || 'Участник'}</h1>
        {user.username && <p>@{user.username}</p>}
      </div>

      <div className="card">
        <h3>Данные</h3>
        <p>Возраст: {user.age ?? '—'}</p>
        <p>Город: {user.city || '—'}</p>
        <p>Цена слова: {user.priceOfWord != null ? `${user.priceOfWord.toLocaleString('ru-RU')} ₽` : '—'}</p>
        <p>Жизни (форс-мажор): {user.forceMajeureAllowed}</p>
      </div>

      <div className="card">
        <h3>Цель</h3>
        <p>{user.goal || '—'}</p>
      </div>

      {user.beforePhoto && (
        <div className="card">
          <h3>«До»</h3>
          <img className="preview" src={user.beforePhoto} alt="до" />
          {user.beforeDescription && <p style={{ marginTop: 10 }}>{user.beforeDescription}</p>}
        </div>
      )}

      {user.measurements && (
        <div className="card">
          <h3>Замеры</h3>
          <p>{user.measurements}</p>
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
        {user.extraTasks.map((t) => (
          <div className="checkbox-row" key={t.id}>
            <input type="checkbox" checked readOnly />
            <span className="label">{t.label}</span>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" onClick={startEdit}>
        Редактировать анкету
      </button>
    </div>
  );
}
