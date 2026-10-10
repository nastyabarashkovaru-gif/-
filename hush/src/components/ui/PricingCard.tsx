import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PricingCardProps {
  title: string;
  description: string;
  price: string;
  perMonth?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
  /** Дополнительный блок под описанием (например, пояснение про раскрытие автора). */
  footer?: ReactNode;
}

export function PricingCard({ title, description, price, perMonth, badge, selected, onSelect, footer }: PricingCardProps) {
  return (
    <motion.div
      whileTap={{ scale: 0.99 }}
      className={cn(
        'relative rounded-card border transition-colors duration-200',
        selected ? 'border-accent bg-[#1E1A2E]' : 'border-border bg-surface hover:border-[#3A3C48]',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full items-start gap-3 px-4 py-4 text-left"
      >
        <span
          aria-hidden
          className={cn(
            'mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-colors duration-150',
            selected ? 'border-accent bg-accent' : 'border-[#4A4C58]',
          )}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-[2px] bg-white" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">{title}</span>
            {badge && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold leading-4 text-white">{badge}</span>
            )}
          </span>
          <span className="mt-1 block text-[13px] leading-[18px] text-muted">{description}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block whitespace-nowrap text-[17px] font-semibold leading-6">{price}</span>
          {perMonth && <span className="mt-1 block whitespace-nowrap text-[12px] leading-4 text-muted">{perMonth}</span>}
        </span>
      </button>
      {footer && <div className="px-4 pb-4 pl-[46px]">{footer}</div>}
    </motion.div>
  );
}
