import { useCallback } from 'react';
import { renderAnswerCard } from '@/lib/qaCards';
import { useAppState } from '@/state/AppState';
import { canvasToUrl, StoryDeckSheet } from '../StoriesSheet';

/** Одна карточка «вопрос — ответ» на всю сторис с QR на личную ссылку */
export function AnswerStoriesSheet({ item, onClose }: { item: { text: string; answer: string | null }; onClose: () => void }) {
  const { qa } = useAppState();
  const link = qa?.link ?? `https://t.me/Hush_miniapp_bot/app`;
  const render = useCallback(async () => {
    const canvas = await renderAnswerCard({ question: item.text, answer: item.answer ?? '', link });
    return [{ src: await canvasToUrl(canvas), alt: item.text }];
  }, [item, link]);
  return (
    <StoryDeckSheet
      open
      onClose={onClose}
      title="Поделись ответом в сторис 💜"
      subtitle="Карточка с вопросом и ответом — подписчики смогут задать тебе свой вопрос по QR"
      render={render}
      link={link}
      shareText="Задай мне вопрос анонимно 🤫"
      widgetName="Задать вопрос"
      kind="answer"
    />
  );
}
