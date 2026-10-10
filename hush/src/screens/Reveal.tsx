import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '@/api';
import { haptic, isTelegram, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { revealedIdentities, useResults } from '@/state/results';
import { BigIcon, Cta, DotIcon, LoadingScreen, Modal, RhombusIcon, Screen, SettingsButton, SmallBack, Spacer, TopBar, useToast } from '@/ui';
import { AnswerList } from './Dashboard';

/** 07 — узнать автора; 07b — автор остался анонимным */
export function RevealScreen({ qid, respondentId }: { qid: string; respondentId: string }) {
  const nav = useNav();
  const toast = useToast();
  const { entitlement, questionnaires } = useAppState();
  const count = questionnaires.find((q) => q.id === qid)?.respondentCount ?? 0;
  const { data } = useResults(qid, `${count}:${entitlement.plan}`);
  const [busy, setBusy] = useState(false);
  const [anonymousOpen, setAnonymousOpen] = useState(false);
  const [identity, setIdentity] = useState(revealedIdentities.get(respondentId));

  if (!data) return <LoadingScreen />;
  const list = data.respondents;
  const index = Math.max(0, list.findIndex((r) => r.id === respondentId));
  const respondent = list[index];
  const next = list[(index + 1) % list.length];

  const goNext = () => {
    setAnonymousOpen(false);
    nav.replace({ name: 'reveal', qid, respondentId: next.id });
  };

  const reveal = async () => {
    setBusy(true);
    try {
      // Сервер сначала проверяет согласие автора, и только потом — права/оплату
      const result = await api.requestReveal(qid, respondent.id);
      if (result.status === 'anonymous') {
        haptic.notify('warning');
        setAnonymousOpen(true);
      } else if (result.status === 'requires_plan') {
        nav.push({ name: 'premium' });
      } else {
        haptic.notify('success');
        revealedIdentities.set(respondent.id, result.identity);
        setIdentity(result.identity);
      }
    } catch {
      toast.show('Не удалось проверить. Попробуй ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const visible = respondent.answers.filter((a) => !a.locked);

  return (
    <Screen fixed>
      <TopBar right={<SettingsButton onClick={() => nav.push({ name: 'settings' })} />} />
      <h2 className="h2">Вот что о тебе думают 👀</h2>

      <div className="card no-scrollbar flex max-h-[42%] shrink-0 flex-col gap-[8px] overflow-y-auto">
        <span className="tag self-start">Аноним №{respondent.number}</span>
        <div className="mt-[10px] flex flex-col gap-[8px]">
          <AnswerList answers={visible} compact />
        </div>
      </div>

      <Spacer />
      <div className="card-purple flex shrink-0 flex-col gap-[20px] !p-[22px] text-center">
        <AnimatePresence mode="wait" initial={false}>
          {identity ? (
            <motion.div key="identity" className="flex flex-col items-center gap-[14px]" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
              <BigIcon size={60}>
                {identity.photoUrl ? (
                  <img src={identity.photoUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="text-[24px] font-extrabold">{identity.firstName.charAt(0)}</span>
                )}
              </BigIcon>
              <h2 className="h2">{identity.firstName}</h2>
              {identity.username && (
                <button type="button" onClick={() => openExternal(`https://t.me/${identity.username}`)} className="-mt-[8px] text-[14px] font-semibold text-purple-text">
                  @{identity.username}
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div key="ask" className="flex flex-col gap-[20px]" exit={{ opacity: 0, scale: 0.96 }}>
              <BigIcon size={60}>
                <DotIcon size={28} />
              </BigIcon>
              <h2 className="h2">Хочешь узнать, кто это написал? 👀</h2>
            </motion.div>
          )}
        </AnimatePresence>
        {identity ? (
          <Cta icon="right" onClick={goNext} disabled={list.length < 2}>
            Следующий аноним
          </Cta>
        ) : (
          <Cta onClick={reveal} loading={busy}>
            🔓 Узнать автора 😍
          </Cta>
        )}
      </div>
      <Spacer />
      {!isTelegram() && <SmallBack onClick={() => nav.back()} />}

      <Modal open={anonymousOpen} onClose={() => setAnonymousOpen(false)} labelledBy="anon-title">
        <div className="card-purple flex flex-col gap-[18px] !px-[18px] !py-[28px] text-center">
          <BigIcon>
            <RhombusIcon size={30} />
          </BigIcon>
          <h2 id="anon-title" className="h2">
            Автор остался анонимным
          </h2>
          <p className="muted">К сожалению, этот автор пожелал остаться анонимным. Попробуй узнать, кто оставил другие ответы 👀</p>
          <Cta icon="right" onClick={goNext}>
            Следующий аноним
          </Cta>
        </div>
      </Modal>
    </Screen>
  );
}
