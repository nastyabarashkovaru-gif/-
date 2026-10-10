import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { questionnaireLink } from '@/config';
import { copyText, SHARE_BODY, SHARE_INTRO, shareMessage, shareQuestionnaire } from '@/lib/share';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { BigIcon, CloseButton, Cta, Screen, Spacer, TopBar, useToast } from '@/ui';

export function useShare(qid: string) {
  const toast = useToast();
  return async () => {
    const result = await shareQuestionnaire(questionnaireLink(qid));
    if (result === 'copied') toast.show('Ссылка скопирована — отправь её друзьям');
    if (result === 'failed') toast.show('Не получилось поделиться. Скопируй сообщение вручную');
  };
}

/** 03 — анкета готова, поделиться */
export function ShareScreen({ qid }: { qid: string }) {
  const nav = useNav();
  const share = useShare(qid);
  const [copied, setCopied] = useState(false);
  const link = questionnaireLink(qid);
  const toDashboard = () => nav.reset({ name: 'dashboard', qid });

  const copy = async () => {
    const ok = await copyText(shareMessage(link));
    if (!ok) return;
    haptic.notify('success');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen fixed>
      <TopBar right={<CloseButton onClick={toDashboard} />} />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}>
        <BigIcon>
          <Check size={30} strokeWidth={2.4} />
        </BigIcon>
      </motion.div>
      <h1 className="h1 text-center">Твоя анкета готова!</h1>
      <p className="muted text-center">Отправь её друзьям и узнай, что они думают о тебе.</p>

      <div className="card shrink-0">
        <div className="step mb-[17px]">Сообщение для друзей</div>
        <div className="text-[15px] leading-[1.8]">
          {SHARE_INTRO}
          <br />
          <br />
          {SHARE_BODY}
          <br />
          <br />
          <span className="break-all text-[12px] text-purple-text">{link}</span>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={copy} className="small -mr-1 flex items-center gap-[5px] px-1 active:opacity-60" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={String(copied)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="flex items-center gap-[5px]">
                {copied ? <Check size={11} strokeWidth={2.4} /> : <Copy size={10} strokeWidth={2.2} />}
                {copied ? 'Скопировано' : 'Скопировать'}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>

      <Spacer />
      <Cta icon="upRight" onClick={share}>
        Поделиться с друзьями
      </Cta>
      <p className="small text-center">Отправь ссылку 5–10 друзьям или опубликуй в соцсетях, чтобы получить ответы.</p>
      <button type="button" onClick={toDashboard} className="mx-auto -my-1 flex items-center gap-[5px] px-2 py-1 text-[13px] font-semibold text-purple-text active:opacity-60">
        Перейти к моим ответам
        <ArrowRight size={14} strokeWidth={2.4} aria-hidden />
      </button>
    </Screen>
  );
}
