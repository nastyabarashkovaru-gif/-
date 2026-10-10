import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LockedAnswer } from './LockedAnswer';

export interface AnswerItem {
  question: string;
  answer: string;
  visible: boolean;
}

interface AnswerCardProps {
  number: number;
  receivedAgo: string;
  items: AnswerItem[];
  expanded: boolean;
  onToggle: () => void;
  onUnlock: () => void;
  /** Небольшая метка в шапке, например «Открыт бесплатно». */
  badge?: string;
}

export function AnswerCard({ number, receivedAgo, items, expanded, onToggle, onUnlock, badge }: AnswerCardProps) {
  const visibleCount = items.filter((i) => i.visible).length;
  const preview = items.find((i) => i.visible);
  const allOpen = visibleCount === items.length;
  const panelId = `answer-panel-${number}`;

  return (
    <motion.article
      layout="position"
      className={cn(
        'overflow-hidden rounded-card border bg-surface transition-colors duration-200',
        expanded ? 'border-[#34364A]' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 pb-3 pt-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">Ответ №{number}</h3>
            {badge && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold leading-4 text-accentSoft">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">
            {receivedAgo} · {allOpen ? 'все 5 ответов' : `открыто ${visibleCount} из ${items.length}`}
          </p>
        </div>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="mt-0.5 flex h-6 w-6 items-center justify-center text-muted"
          aria-hidden
        >
          <ChevronDown size={20} />
        </motion.span>
      </button>

      {!expanded && preview && (
        <button type="button" onClick={onToggle} className="block w-full px-4 pb-4 text-left" tabIndex={-1}>
          <p className="text-[13px] leading-[18px] text-muted">{preview.question}</p>
          <p className="mt-1 line-clamp-2 text-[15px] leading-[22px] text-text">{preview.answer}</p>
          {!allOpen && (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accentSoft">
              <Lock size={13} strokeWidth={2.25} />
              Ещё {items.length - visibleCount} скрыто
            </p>
          )}
        </button>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="space-y-4 px-4 pb-4">
              {items.map((item, i) =>
                item.visible ? (
                  <div key={i} className={cn(i > 0 && 'border-t border-border pt-4')}>
                    <p className="text-[13px] leading-[18px] text-muted">{item.question}</p>
                    <p className="mt-1.5 text-[15px] leading-[22px] text-text">{item.answer}</p>
                  </div>
                ) : (
                  <div key={i} className={cn(i > 0 && 'border-t border-border pt-4')}>
                    <LockedAnswer question={item.question} onUnlock={onUnlock} />
                  </div>
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
