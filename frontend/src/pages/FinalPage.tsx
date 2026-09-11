import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useUser } from '../context/UserContext';
import { FinaleStatus } from '../types';

export default function FinalPage() {
  const { refresh } = useUser();
  const navigate = useNavigate();
  const [status, setStatus] = useState<FinaleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api
      .get<FinaleStatus>('/finale/status')
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  const createPaymentLink = async () => {
    setPayError(null);
    try {
      const res = await api.post<{ link: string }>('/payments/word-price/create-link');
      setPayLink(res.link);
      window.open(res.link, '_blank');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'prodamus_not_configured') {
        setPayError('Оплата пока не настроена организаторами. Свяжитесь с клубом напрямую.');
      } else {
        setPayError('Не удалось создать ссылку на оплату.');
      }
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await api.post('/users/me/restart');
      await refresh();
      navigate('/onboarding');
    } finally {
      setRestarting(false);
    }
  };

  if (loading || !status) return <div className="screen">Загрузка…</div>;

  return (
    <div className="screen">
      <h1>Финал челленджа</h1>

      {status.state === 'winner' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="badge accent" style={{ marginBottom: 10 }}>
            🏆 Победа
          </div>
          <h2>{status.message}</h2>
          <p style={{ marginTop: 10 }}>Свяжитесь с организаторами, чтобы получить выплату призового фонда.</p>
          <button className="btn btn-primary" onClick={() => window.open('https://t.me/', '_blank')}>
            Связаться с организаторами
          </button>
        </div>
      )}

      {status.state === 'finished_unconfirmed' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="badge accent" style={{ marginBottom: 10 }}>
            Ты дошёл(ла) до конца!
          </div>
          <p>{status.message}</p>
          {status.quote && <p style={{ fontStyle: 'italic', marginTop: 12 }}>«{status.quote}»</p>}
          <button className="btn btn-primary" onClick={restart} disabled={restarting} style={{ marginTop: 14 }}>
            {restarting ? 'Запускаем…' : 'Начать новые 100 дней'}
          </button>
        </div>
      )}

      {status.state === 'not_finished' && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>{status.message}</p>
          {status.amountDue != null && (
            <h2 style={{ margin: '12px 0' }}>{status.amountDue.toLocaleString('ru-RU')} ₽</h2>
          )}
          <button className="btn btn-primary" onClick={createPaymentLink}>
            Оплатить цену слова
          </button>
          {payError && <div className="error-text" style={{ marginTop: 8 }}>{payError}</div>}
          {payLink && (
            <p style={{ marginTop: 8 }}>
              Если окно не открылось,{' '}
              <a href={payLink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                перейдите по ссылке
              </a>
              .
            </p>
          )}
          <button className="btn btn-secondary" onClick={restart} disabled={restarting} style={{ marginTop: 14 }}>
            {restarting ? 'Запускаем…' : 'Начать новые 100 дней'}
          </button>
        </div>
      )}
    </div>
  );
}
