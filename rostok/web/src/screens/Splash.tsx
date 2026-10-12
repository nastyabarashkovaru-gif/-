import { Sprout } from '../art/Tree';

export function Splash({ appName, slogan, error, onRetry }: { appName: string; slogan: string; error?: string | null; onRetry?: () => void }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8" role="status" aria-live="polite">
      <div className="splash-sway">
        <Sprout size={112} sway={false} title="Росток" />
      </div>
      <div className="mt-3 text-[26px] font-extrabold tracking-[0.18em] text-leaf-deep">{appName}</div>
      <div className="mt-2 max-w-[260px] text-center text-[13px] leading-snug text-ink-mute">{slogan}</div>
      {error ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <div className="text-[15px] text-ink">{error}</div>
          {onRetry && <button onClick={onRetry} className="rounded-btn bg-leaf-soft px-5 py-3 font-semibold text-leaf-deep">Попробовать ещё раз</button>}
        </div>
      ) : (
        <div className="mt-10 h-[3px] w-24 overflow-hidden rounded-full bg-leaf-soft" aria-label="Загрузка">
          <div className="loading-bar h-full w-10 rounded-full bg-leaf" />
        </div>
      )}
    </div>
  );
}
