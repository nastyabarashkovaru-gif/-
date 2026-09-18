import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useUser } from '../context/UserContext';
import Avatar from '../components/Avatar';
import PhotoUpload from '../components/PhotoUpload';
import { ExtraTaskDef, UserProfile } from '../types';

const OPTIONAL_TASKS: { id: string; label: string }[] = [
  { id: 'no_flour', label: 'Отказ от мучного' },
  { id: 'no_sugar', label: 'Отказ от сладкого' },
  { id: 'no_food_after_18', label: 'Не есть после 18:00' },
  { id: 'no_food_after_20', label: 'Не есть после 20:00' },
  { id: 'steps_10000', label: '10 000 шагов в день' },
];

export default function OnboardingPage() {
  const { user, refresh } = useUser();
  const navigate = useNavigate();

  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [goal, setGoal] = useState('');
  const [beforePhoto, setBeforePhoto] = useState<string | null>(null);
  const [beforeDescription, setBeforeDescription] = useState('');
  const [measurements, setMeasurements] = useState('');
  const [priceOfWord, setPriceOfWord] = useState('');
  const [forceMajeure, setForceMajeure] = useState('3');
  const [selectedOptional, setSelectedOptional] = useState<string[]>([]);
  const [customTask, setCustomTask] = useState('');
  const [customTasks, setCustomTasks] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const toggleOptional = (id: string) => {
    setSelectedOptional((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addCustomTask = () => {
    const text = customTask.trim();
    if (!text) return;
    setCustomTasks((prev) => [...prev, text]);
    setCustomTask('');
  };

  const removeCustomTask = (text: string) => {
    setCustomTasks((prev) => prev.filter((t) => t !== text));
  };

  const handleSubmit = async () => {
    setError(null);

    const priceNum = Number(priceOfWord);
    const forceMajeureNum = Number(forceMajeure);

    if (!priceOfWord || Number.isNaN(priceNum) || priceNum < 0) {
      setError('Цена слова — укажите число в рублях');
      return;
    }
    if (!forceMajeure || Number.isNaN(forceMajeureNum) || forceMajeureNum < 0) {
      setError('Форс-мажор — укажите число (сколько раз можно пропустить)');
      return;
    }

    const extraTasks: ExtraTaskDef[] = [
      ...OPTIONAL_TASKS.filter((t) => selectedOptional.includes(t.id)),
      ...customTasks.map((label, i) => ({ id: `custom_${i}_${Date.now()}`, label, isCustom: true })),
    ];

    setSubmitting(true);
    try {
      await api.put<UserProfile>('/users/me', {
        age: age ? Number(age) : undefined,
        city: city || undefined,
        goal: goal || undefined,
        beforePhoto: beforePhoto || undefined,
        beforeDescription: beforeDescription || undefined,
        measurements: measurements || undefined,
        priceOfWord: priceNum,
        forceMajeureAllowed: forceMajeureNum,
        extraTasks,
      });
      await refresh();
      navigate('/progress');
    } catch (e: any) {
      setError('Не получилось сохранить анкету. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen">
      <div className="top-header" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Avatar url={user.photoUrl} name={user.firstName} size="lg" />
        <h1 style={{ marginTop: 12 }}>{user.firstName || 'Участник'}</h1>
        {user.username && <p>@{user.username}</p>}
      </div>

      <h2>Анкета участника</h2>
      <p>Заполни данные перед стартом «100 дней спорта».</p>

      <div className="field">
        <label>Возраст</label>
        <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Например, 28" />
      </div>

      <div className="field">
        <label>Город</label>
        <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" />
      </div>

      <div className="field">
        <label>Цель</label>
        <textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Что хочешь получить за 100 дней?" />
      </div>

      <div className="field">
        <label>«До»: фото</label>
        <PhotoUpload value={beforePhoto} onChange={(url) => setBeforePhoto(url)} accept="image/*" label="Загрузить фото «до»" />
      </div>

      <div className="field">
        <label>«До»: краткое описание</label>
        <textarea
          rows={2}
          value={beforeDescription}
          onChange={(e) => setBeforeDescription(e.target.value)}
          placeholder="Пару слов о своей форме сейчас"
        />
      </div>

      <div className="field">
        <label>Замеры (опционально)</label>
        <textarea rows={2} value={measurements} onChange={(e) => setMeasurements(e.target.value)} placeholder="Вес, объёмы и т.д." />
      </div>

      <div className="field">
        <label>Цена слова, ₽</label>
        <input
          type="number"
          value={priceOfWord}
          onChange={(e) => setPriceOfWord(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Например, 5000"
        />
        <div className="hint">Сумма, которую вносишь в общий призовой фонд, если не дойдёшь до конца.</div>
      </div>

      <div className="field">
        <label>Форс-мажор</label>
        <input
          type="number"
          value={forceMajeure}
          onChange={(e) => setForceMajeure(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="3"
        />
        <div className="hint">Жизни даю себе — сколько раз за весь челлендж можно пропустить отчёт.</div>
      </div>

      <h3>Ежедневные задачи</h3>
      <div className="checkbox-row mandatory">
        <input type="checkbox" checked readOnly />
        <span className="label">
          Ежедневная тренировка <span className="star">★</span>
        </span>
      </div>

      <p>Если хочешь похудеть быстрее — можешь выбрать дополнительные ежедневные действия и отчитываться по ним.</p>

      {OPTIONAL_TASKS.map((task) => (
        <label className="checkbox-row" key={task.id}>
          <input type="checkbox" checked={selectedOptional.includes(task.id)} onChange={() => toggleOptional(task.id)} />
          <span className="label">{task.label}</span>
        </label>
      ))}

      {customTasks.map((task) => (
        <div className="checkbox-row" key={task}>
          <input type="checkbox" checked readOnly />
          <span className="label">{task}</span>
          <button type="button" className="btn btn-danger" style={{ width: 'auto', padding: '6px 10px' }} onClick={() => removeCustomTask(task)}>
            ✕
          </button>
        </div>
      ))}

      <div className="field" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label>Своя задача</label>
          <input type="text" value={customTask} onChange={(e) => setCustomTask(e.target.value)} placeholder="Например, растяжка 10 минут" />
        </div>
        <button type="button" className="btn btn-secondary" style={{ width: 'auto', padding: '13px 18px' }} onClick={addCustomTask}>
          Добавить
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Сохраняем…' : 'Войти в приложение'}
      </button>
    </div>
  );
}
