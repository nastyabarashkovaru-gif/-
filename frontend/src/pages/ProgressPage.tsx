import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useUser } from '../context/UserContext';
import { ProgressData, DayReport } from '../types';
import DayGrid, { dayIndexFromStart } from '../components/DayGrid';
import PhotoUpload from '../components/PhotoUpload';
import { hapticSuccess } from '../telegram/webapp';

export default function ProgressPage() {
  const { user } = useUser();
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [trainingMedia, setTrainingMedia] = useState<string | null>(null);
  const [extraChecks, setExtraChecks] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const data = await api.get<ProgressData>('/progress/me');
    setProgress(data);
    setLoading(false);
    return data;
  };

  useEffect(() => {
    load().then((data) => {
      if (data) setSelectedDay(Math.min(dayIndexFromStart(data.startDate), data.challengeDays) || 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!progress || selectedDay == null) return;
    const report = progress.grid[selectedDay - 1];
    setTrainingMedia(report?.trainingMediaUrl || null);
    setExtraChecks(report?.extraTasksDone || {});
  }, [selectedDay, progress]);

  if (loading || !user || !progress) return <div className="screen">Загрузка…</div>;

  const selectedReport: DayReport | null = selectedDay ? progress.grid[selectedDay - 1] : null;
  const currentDay = Math.min(dayIndexFromStart(progress.startDate), progress.challengeDays);
  const isFutureDay = selectedDay != null && selectedDay > currentDay;

  const toggleExtra = (id: string) => {
    setExtraChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const saveDay = async (markTrainingDone: boolean) => {
    if (!selectedDay) return;
    if (markTrainingDone && !trainingMedia) {
      setError('Прикрепи фото или видео тренировки, чтобы отметить выполнение');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.post(`/progress/day/${selectedDay}`, {
        trainingDone: markTrainingDone,
        trainingMediaUrl: trainingMedia,
        extraTasksDone: extraChecks,
      });
      hapticSuccess();
      await load();
    } catch (e: any) {
      setError(e.message === 'training_requires_media' ? 'Нужно прикрепить фото или видео тренировки' : 'Не удалось сохранить отчёт');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <h1>Прогресс</h1>

      <div className="stat-box" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="value">{progress.completedTrainingDays}</div>
          <div className="label">Тренировок</div>
        </div>
        <div className="stat">
          <div className="value">{Math.max(0, progress.forceMajeureAllowed - Math.max(0, currentDay - progress.completedTrainingDays))}</div>
          <div className="label">Жизней осталось</div>
        </div>
        <div className="stat">
          <div className="value">{currentDay}/{progress.challengeDays}</div>
          <div className="label">День</div>
        </div>
      </div>

      {currentDay >= progress.challengeDays && (
        <Link to="/final" className="btn btn-primary" style={{ marginBottom: 16, textDecoration: 'none' }}>
          Смотреть итог челленджа →
        </Link>
      )}

      <DayGrid grid={progress.grid} startDate={progress.startDate} onSelectDay={setSelectedDay} />

      {selectedReport && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3>День {selectedReport.dayNumber}</h3>
          {isFutureDay && <p>Этот день ещё не наступил.</p>}

          {!isFutureDay && (
            <>
              <div className="field">
                <label>Тренировка ★</label>
                <PhotoUpload value={trainingMedia} onChange={(url) => setTrainingMedia(url)} />
              </div>

              {user.extraTasks.length > 0 && (
                <div className="field">
                  <label>Дополнительные задачи</label>
                  {user.extraTasks.map((t) => (
                    <label className="checkbox-row" key={t.id}>
                      <input type="checkbox" checked={!!extraChecks[t.id]} onChange={() => toggleExtra(t.id)} />
                      <span className="label">{t.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {error && <div className="error-text">{error}</div>}

              <button className="btn btn-primary" onClick={() => saveDay(true)} disabled={saving}>
                {saving ? 'Сохраняем…' : selectedReport.trainingDone ? 'Обновить отчёт' : 'Отметить день выполненным'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
