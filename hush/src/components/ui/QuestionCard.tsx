import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/cn';

interface QuestionCardProps {
  text: string;
  selected: boolean;
  onToggle: () => void;
  /** Меняется, когда карточку нужно слегка «встряхнуть» (лимит выбора). */
  shakeSignal?: number;
}

export function QuestionCard({ text, selected, onToggle, shakeSignal }: QuestionCardProps) {
  const controls = useAnimationControls();

  useEffect(() => {
    if (!shakeSignal) return;
    void controls.start({ x: [0, -4, 4, -2, 0], transition: { duration: 0.25 } });
  }, [shakeSignal, controls]);

  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      animate={controls}
      whileTap={{ scale: 0.985 }}
      className={cn(
        'flex min-h-[60px] w-full items-center gap-3 rounded-card border px-4 py-3.5 text-left transition-colors duration-200',
        selected
          ? 'border-accent bg-[#1E1A2E]'
          : 'border-border bg-surface hover:border-[#3A3C48] active:bg-surface2',
      )}
    >
      <span className={cn('flex-1 text-[15px] leading-[21px]', selected ? 'text-text' : 'text-[#E4E4E7]')}>{text}</span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
        <AnimatePresence initial={false}>
          {selected && (
            <motion.span
              key="check"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent"
            >
              <Check size={15} strokeWidth={3} className="text-white" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
