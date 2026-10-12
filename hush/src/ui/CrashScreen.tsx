import { RotateCw } from 'lucide-react';

/** Запасной экран, если приложение упало целиком (без провайдеров — только разметка) */
export function CrashScreen() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-app flex-col items-center justify-center gap-[14px] bg-black px-[23px] text-center">
      <h1 className="h1">Что-то пошло не так</h1>
      <p className="muted">Мы уже получили сообщение об ошибке. Перезапусти приложение — твоя анкета сохранена.</p>
      <button type="button" onClick={() => window.location.reload()} className="cta mt-[10px] w-full">
        <RotateCw size={20} strokeWidth={1.8} />
        Перезапустить
      </button>
    </div>
  );
}
