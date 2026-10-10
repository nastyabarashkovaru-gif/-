import type { CloudPaymentsParams } from '@/api';

/** Виджет оплаты CloudPayments: https://developers.cloudpayments.ru/#ustanovka-vidzheta */
const SCRIPT = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js';

interface CpWidget {
  pay(
    method: 'charge' | 'auth',
    options: CloudPaymentsParams,
    callbacks: { onSuccess?: (o: unknown) => void; onFail?: (reason: string, o: unknown) => void; onComplete?: (r: unknown) => void },
  ): void;
}

declare global {
  interface Window {
    cp?: { CloudPayments: new (opts?: { language?: string }) => CpWidget };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.cp) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('cloudpayments_load_failed'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type PayOutcome = { status: 'success' } | { status: 'cancel' } | { status: 'fail'; reason: string };

/** Открывает виджет; результат — только для интерфейса, доступ выдаёт сервер по уведомлению */
export async function payWithCloudPayments(params: CloudPaymentsParams): Promise<PayOutcome> {
  await loadScript();
  const widget = new window.cp!.CloudPayments({ language: 'ru-RU' });
  return new Promise<PayOutcome>((resolve) => {
    let done = false;
    const finish = (o: PayOutcome) => {
      if (!done) {
        done = true;
        resolve(o);
      }
    };
    widget.pay('charge', params, {
      onSuccess: () => finish({ status: 'success' }),
      onFail: (reason) => finish(/cancel/i.test(reason) ? { status: 'cancel' } : { status: 'fail', reason }),
      onComplete: () => finish({ status: 'cancel' }),
    });
  });
}
