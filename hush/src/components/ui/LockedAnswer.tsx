import { Lock } from 'lucide-react';

interface LockedAnswerProps {
  question: string;
  onUnlock: () => void;
}

/** Скрытый ответ: показываем только вопрос и замок, без имитации текста. */
export function LockedAnswer({ question, onUnlock }: LockedAnswerProps) {
  return (
    <div>
      <p className="text-[13px] leading-[18px] text-muted">{question}</p>
      <button
        type="button"
        onClick={onUnlock}
        className="mt-2 flex min-h-touch w-full items-center gap-3 rounded-control border border-border bg-[repeating-linear-gradient(135deg,#1B1C25_0px,#1B1C25_6px,#1E1F29_6px,#1E1F29_12px)] px-3 py-2.5 text-left transition-colors duration-150 hover:border-[#3A3C48]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15">
          <Lock size={14} strokeWidth={2.25} className="text-accentSoft" />
        </span>
        <span className="flex-1 text-[14px] font-medium text-[#D4D4D8]">Ответ скрыт</span>
        <span className="text-[13px] font-semibold text-accentSoft">Открыть</span>
      </button>
    </div>
  );
}
