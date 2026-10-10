import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, EyeOff, LockOpen } from 'lucide-react';
import { api } from '@/api';
import { payWithCloudPayments } from '@/lib/cloudpayments';
import { formatRub } from '@/lib/plural';
import { haptic, isTelegram, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { revealedIdentities, useResults } from '@/state/results';
import { BigIcon, Cta, LoadingScreen, Modal, Screen, SettingsButton, SmallBack, Spacer, TopBar, useToast } from '@/ui';
import { AnswerList } from './Dashboard';

/** 07 — узнать автора; 07b — автор остался анонимным */
export function RevealScreen({ qid, respondentId }: { qid: string; respondentId: string }) {
  const nav = useNav();
  const toast = useToast();
  const { entitlement, questionnaires, isPremium } = useAppState();
  const count = questionnaires.find((q) => q.id === qid)?.respondentCount ?? 0;
  const { data } = useResults(qid, `${count}:${entitlement.plan}`);
  const [busy, setBusy] = useState(false);
  const [anonymousOpen, setAnonymousOpen] = useState(false);
  const [identity, setIdentity] = useState(revealedIdentities.get(respondentId));
  const [purchase, setPurchase] = useState<{ price: number } | null>(null);
  const [paying, setPaying] = useState(false);

  // Узнать автора можно только после покупки подписки
  useEffect(() => {
    if (!isPremium) nav.replace({ name: 'premium' });
  }, [isPremium, nav]);

  if (!data || !isPremium) return <LoadingScreen />;
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
      } else if (result.status === 'requires_purchase') {
        setPurchase({ price: result.price });
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

  /** Разовая покупка автора: доступ выдаёт сервер по уведомлению CloudPayments */
  const buyReveal = async () => {
    setPaying(true);
    try {
      const checkout = await api.startRevealCheckout(qid, respondent.id);
      if (checkout.status === 'widget') {
        const outcome = await payWithCloudPayments(checkout.params);
        if (outcome.status === 'cancel') return;
        if (outcome.status === 'fail') {
          haptic.notify('error');
          toast.show('Оплата не прошла. Попробуй другую карту');
          return;
        }
      } else if (checkout.status !== 'ok') {
        toast.show('Оплата пока недоступна');
        return;
      }
      // Ждём подтверждения оплаты на сервере
      for (let i = 0; i < 10; i++) {
        const result = await api.requestReveal(qid, respondent.id);
        if (result.status === 'revealed') {
          haptic.notify('success');
          revealedIdentities.set(respondent.id, result.identity);
          setIdentity(result.identity);
          setPurchase(null);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      toast.show('Оплата прошла — автор откроется через пару минут');
      setPurchase(null);
    } catch {
      toast.show('Не удалось открыть оплату. Попробуй ещё раз');
    } finally {
      setPaying(false);
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
                <Eye size={28} strokeWidth={1.8} />
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
          <Cta leading={<LockOpen size={20} strokeWidth={1.8} className="text-green" />} onClick={reveal} loading={busy}>
            Узнать автора 😍
          </Cta>
        )}
      </div>
      <Spacer />
      {!isTelegram() && <SmallBack onClick={() => nav.back()} />}

      <Modal open={anonymousOpen} onClose={() => setAnonymousOpen(false)} labelledBy="anon-title">
        <div className="card-purple flex flex-col gap-[18px] !px-[18px] !py-[28px] text-center">
          <BigIcon>
            <EyeOff size={28} strokeWidth={1.8} />
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

      <Modal open={purchase !== null} onClose={() => !paying && setPurchase(null)} labelledBy="buy-title">
        <div className="card-purple flex flex-col gap-[16px] !px-[18px] !pb-[20px] !pt-[28px] text-center">
          <BigIcon size={64}>
            <Eye size={28} strokeWidth={1.8} />
          </BigIcon>
          <h2 id="buy-title" className="h2">
            Автор разрешил узнать, кто он 👀
          </h2>
          <p className="muted">
            Узнай, кто это написал, за {formatRub(purchase?.price ?? 99)} — это разовый платёж. На годовом тарифе — без ограничений.
          </p>
          <Cta leading={<LockOpen size={20} strokeWidth={1.8} className="text-green" />} onClick={buyReveal} loading={paying} className="mt-[4px]">
            Узнать за {formatRub(purchase?.price ?? 99)}
          </Cta>
          <button type="button" onClick={() => setPurchase(null)} disabled={paying} className="mx-auto -mt-[4px] px-3 py-2 text-[15px] text-[#a1a1aa] active:opacity-60">
            Не сейчас
          </button>
        </div>
      </Modal>
    </Screen>
  );
}
