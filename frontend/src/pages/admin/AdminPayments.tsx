import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { adminApi } from '../../api/client';

interface AdminPayment {
  id: number;
  user_id: number;
  username: string | null;
  first_name: string | null;
  amount: number;
  kind: string;
  status: string;
  prodamus_order_id: string | null;
  created_at: string;
  paid_at: string | null;
}

export default function AdminPayments() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    adminApi.get<AdminPayment[]>('/admin/payments').then(setPayments).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) {
      navigate('/admin/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markPaid = async (id: number) => {
    await adminApi.put(`/admin/payments/${id}/mark-paid`);
    load();
  };

  return (
    <div className="app-shell" style={{ paddingBottom: 24 }}>
      <div className="screen">
        <button className="btn btn-secondary" style={{ width: 'auto', padding: '8px 14px', marginBottom: 16 }} onClick={() => navigate('/admin')}>
          ← К списку участников
        </button>
        <h1>Платежи</h1>

        {loading && <p>Загрузка…</p>}

        {!loading && payments.length === 0 && <p>Платежей пока нет.</p>}

        {!loading && (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Сумма</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Дата</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/users/${p.user_id}`} style={{ color: 'var(--accent)' }}>
                        {p.first_name || p.username || p.user_id}
                      </Link>
                    </td>
                    <td>{p.amount.toLocaleString('ru-RU')} ₽</td>
                    <td>{p.kind === 'word_price' ? 'Цена слова' : 'Выплата приза'}</td>
                    <td>
                      {p.status === 'paid' && <span className="badge accent">Оплачено</span>}
                      {p.status === 'manual_paid' && <span className="badge accent">Оплачено вручную</span>}
                      {p.status === 'pending' && <span className="badge">Ожидает</span>}
                    </td>
                    <td>{new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                    <td>
                      {p.status === 'pending' && (
                        <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 10px' }} onClick={() => markPaid(p.id)}>
                          Отметить оплаченным
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
