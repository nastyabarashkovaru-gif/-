import { nearestJoinableFlow } from './calendar';
import { addMonths, localDate, withDay, type ISODate } from './dates';

/** День месяца, в который проходит списание за следующий период */
export const CHARGE_DAY = 28;

export interface PurchasePlan {
  /** startsOn всех оплаченных потоков по порядку */
  flows: ISODate[];
  firstFlow: ISODate;
  lastFlow: ISODate;
  /** Желаемая дата следующего списания: 28-е число последнего оплаченного месяца */
  targetChargeDate: ISODate;
  /** Дата, которую реально можно выставить у провайдера (перенос только вперёд) */
  chargeDate: ISODate;
  /** Нужно ли вызывать перенос даты у провайдера */
  needsShift: boolean;
  /** Какие потоки оплатит следующее списание */
  renewalFlows: ISODate[];
}

export function coverage(firstFlow: ISODate, months: number): ISODate[] {
  if (!Number.isInteger(months) || months < 1) throw new Error('months must be positive integer');
  return Array.from({ length: months }, (_, i) => addMonths(firstFlow, i));
}

/**
 * Естественная дата следующего списания подписки провайдера: дата оплаты + период.
 * ⚠ Поведение Prodamus на 29–31 числах нужно подтвердить в sandbox; фактическая дата из webhook имеет приоритет.
 */
export function naturalProviderDate(paidOn: ISODate, months: number): ISODate {
  return addMonths(paidOn, months);
}

export function chargeDateFor(lastFlow: ISODate): ISODate {
  return withDay(lastFlow, CHARGE_DAY);
}

export function planPurchase(params: { now: Date; tz: string; months: number; lateJoinUntilDay?: number }): PurchasePlan {
  const { now, tz, months } = params;
  const firstFlow = nearestJoinableFlow(now, tz, params.lateJoinUntilDay ?? 1);
  const flows = coverage(firstFlow, months);
  const lastFlow = flows[flows.length - 1];
  const targetChargeDate = chargeDateFor(lastFlow);
  const natural = naturalProviderDate(localDate(now, tz), months);
  // Prodamus позволяет только отодвинуть дату. Если естественная дата уже позже 28-го — оставляем её.
  const chargeDate = natural <= targetChargeDate ? targetChargeDate : natural;
  return {
    flows,
    firstFlow,
    lastFlow,
    targetChargeDate,
    chargeDate,
    needsShift: chargeDate !== natural,
    renewalFlows: coverage(addMonths(lastFlow, 1), months),
  };
}

/** План продления: следующие `months` потоков после последнего оплаченного, списание снова 28-го */
export function planRenewal(paidThroughFlow: ISODate, months: number) {
  const flows = coverage(addMonths(paidThroughFlow, 1), months);
  const lastFlow = flows[flows.length - 1];
  return { flows, lastFlow, nextChargeDate: chargeDateFor(lastFlow) };
}

export type SubStatus = 'prestart' | 'active' | 'past_due' | 'canceled_at_period_end' | 'expired';

/**
 * Статус подписки на дату. `paidThroughFlow` — startsOn последнего оплаченного потока.
 * past_due: дата списания прошла, а следующий период не оплачен и ещё не начался (grace до конца месяца).
 */
export function subscriptionStatusOn(params: {
  today: ISODate;
  paidFromFlow: ISODate;
  paidThroughFlow: ISODate;
  autoRenew: boolean;
  nextChargeDate: ISODate | null;
}): SubStatus {
  const { today, paidFromFlow, paidThroughFlow, autoRenew, nextChargeDate } = params;
  const paidUntil = addMonths(paidThroughFlow, 1); // первый день после оплаченного периода
  if (today >= paidUntil) return 'expired';
  if (!autoRenew) return 'canceled_at_period_end';
  if (today < paidFromFlow) return 'prestart';
  if (nextChargeDate && today > nextChargeDate) return 'past_due';
  return 'active';
}

/** Есть ли у пользователя оплаченное право на поток */
export function coversFlow(paidFromFlow: ISODate, paidThroughFlow: ISODate, flow: ISODate): boolean {
  return flow >= paidFromFlow && flow <= paidThroughFlow;
}
