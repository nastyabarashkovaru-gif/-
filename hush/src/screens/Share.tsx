import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Check, Copy, Instagram, Send } from 'lucide-react';
import { questionnaireLink } from '@/config';
import { track } from '@/lib/analytics';
import { inviteVariants, renderInviteCard } from '@/lib/inviteCard';
import { useAppState } from '@/state/AppState';
import { canvasToUrl, StoryDeckSheet, type StoryImage } from './StoriesSheet';
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

/** 03 — анкета готова: готовое сообщение для друзей + шаринг */
export function ShareScreen({ qid }: { qid: string }) {
  const nav = useNav();
  const toast = useToast();
  const share = useShare(qid);
  const [copied, setCopied] = useState(false);
  const link = questionnaireLink(qid);
  const toDashboard = () => nav.reset({ name: 'dashboard', qid });
  const [storyOpen, setStoryOpen] = useInviteStoryAuto(qid);

  const copy = async (text: string, message: string) => {
    if (!(await copyText(text))) return;
    haptic.notify('success');
    setCopied(true);
    toast.show(message);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen fixed>
      <TopBar right={<CloseButton onClick={toDashboard} />} />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}>
        <BigIcon size={64}>
          <Check size={28} strokeWidth={2} />
        </BigIcon>
      </motion.div>
      <div className="flex flex-col gap-[10px] text-center">
        <h1 className="h1">Твоя анкета готова!</h1>
        <p className="muted !text-[16px]">Отправь её друзьям и узнай, что они думают о тебе.</p>
      </div>

      <div className="card flex shrink-0 flex-col gap-[14px]">
        <div className="flex items-center justify-between">
          <span className="step">Сообщение для друзей</span>
          <button
            type="button"
            onClick={() => copy(shareMessage(link), 'Сообщение скопировано')}
            aria-label="Скопировать сообщение"
            className="-m-2 flex h-10 w-10 items-center justify-center rounded-full text-[#a1a1aa] active:opacity-60"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={String(copied)} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }}>
                {copied ? <Check size={20} strokeWidth={1.8} className="text-green" /> : <Copy size={20} strokeWidth={1.8} />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
        <p className="text-[16px] leading-[1.4]">{SHARE_INTRO}</p>
        <p className="text-[16px] leading-[1.4]">{SHARE_BODY}</p>
        <button
          type="button"
          onClick={() => copy(link, 'Ссылка скопирована')}
          className="flex items-center gap-[4px] self-start text-left text-[14px] text-purple-text active:opacity-60"
        >
          <span className="break-all underline decoration-dotted decoration-1 underline-offset-[3px]">{link}</span>
          <ArrowUpRight size={15} strokeWidth={1.8} className="shrink-0" aria-hidden />
        </button>
      </div>

      <Spacer />
      <Cta leading={<Send size={20} strokeWidth={1.8} />} onClick={share}>
        Поделиться с друзьями
      </Cta>
      <InviteStoryButton onClick={() => setStoryOpen(true)} />
      <p className="small !text-[14px] text-center">Отправь ссылку 5–10 друзьям или опубликуй в соцсетях, чтобы получить ответы.</p>
      <button type="button" onClick={toDashboard} className="mx-auto -my-1 flex items-center gap-[6px] px-2 py-1 text-[15px] text-[#a1a1aa] active:opacity-60">
        Перейти к моим ответам
        <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
      </button>
      <InviteStoriesSheet qid={qid} open={storyOpen} onClose={() => setStoryOpen(false)} />
    </Screen>
  );
}

/**
 * Окно «Выложи анкету к себе в сторис» открывается само через 1 с — один раз на анкету
 * (на экране 03, а если его пропустили — на экране ожидания ответов).
 */
export function useInviteStoryAuto(qid: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = `hush.inviteStory.${qid}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* приватный режим */
      }
      track('story_sheet_opened', 'invite_auto');
      setOpen(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [qid]);
  return [open, setOpen] as const;
}

export function InviteStoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        track('story_sheet_opened', 'invite_button');
        onClick();
      }}
      className="cta-dark -mt-[8px]"
    >
      <Instagram size={18} strokeWidth={1.8} className="text-purple-text" aria-hidden />
      Выложить в сторис
    </button>
  );
}

/** Карточки-приглашения: QR и личная ссылка на анкету */
export function InviteStoriesSheet({ qid, open, onClose }: { qid: string; open: boolean; onClose: () => void }) {
  const link = questionnaireLink(qid);
  const { questionnaires } = useAppState();
  const questions = questionnaires.find((q) => q.id === qid)?.questions.map((q) => q.text) ?? [];
  const render = useCallback(async () => {
    const out: StoryImage[] = [];
    for (const v of inviteVariants(questions, link)) {
      const canvas = await renderInviteCard(v);
      out.push({ src: await canvasToUrl(canvas), alt: v.headline });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, questions.join('|')]);
  return (
    <StoryDeckSheet
      open={open}
      onClose={onClose}
      title="Выложи анкету к себе в сторис 💜"
      subtitle="Свайпай и выбери карточку — друзья наведут камеру на QR или перейдут по ссылке"
      render={render}
      link={link}
      shareText="Ответь анонимно на 5 вопросов обо мне 👀"
      widgetName="Ответить анонимно"
      kind="invite"
    />
  );
}
