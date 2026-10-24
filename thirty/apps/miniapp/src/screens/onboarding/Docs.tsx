import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { ErrorState, Header, Loading, Screen, useLoad } from '../../ui';

/** Оферта и политика ПДн: текст с сервера, реквизиты подставляются из настроек */
export function DocScreen() {
  const { kind = 'offer' } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<{ text: string }>(`/api/public/docs/${kind}`), [kind]);
  return (
    <Screen id={`DOC_${kind}`}>
      <Header title={kind === 'privacy' ? 'Персональные данные' : 'Публичная оферта'} back />
      {loading ? <Loading lines={2} /> : error || !data ? <ErrorState error={error} retry={reload} /> : (
        <div className="card doc">
          {data.text.split('\n').filter((l) => l.trim()).map((l, i) =>
            l.startsWith('# ') ? <h1 key={i} className="h2">{l.slice(2)}</h1>
              : l.startsWith('## ') ? <h2 key={i} className="h3" style={{ marginTop: 8 }}>{l.slice(3)}</h2>
              : l.startsWith('- ') ? <p key={i} className="doc-li">{l.slice(2)}</p>
              : <p key={i}>{l}</p>,
          )}
        </div>
      )}
    </Screen>
  );
}
