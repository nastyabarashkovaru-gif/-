/**
 * Карточки сторис HUSH 2.0 (1080×1920, рисуются на устройстве).
 * Личная ссылка и свой вопрос — через renderInviteCard (контент по центру, QR и ссылка текстом),
 * ответ на вопрос — отдельный макет: вопрос, ответ, ненавязчивый логотип и QR на личную ссылку.
 */
import QRCode from 'qrcode';
import { renderInviteCard } from './inviteCard';
import { fit, FONT, H, roundRect, W, wrap } from './storyCard';

/** «Задай мне вопрос анонимно 🤫» — несколько вариантов текста */
export function askMeVariants(link: string) {
  return [
    { headline: 'Задай мне вопрос анонимно 🤫', sub: 'Я не узнаю, кто спросил. Спрашивай что угодно', link },
    { label: 'Анонимно', headline: 'Спроси то, что давно хотел(а) узнать 👀', sub: 'Отвечу на самые интересные вопросы в сторис', link },
    { headline: 'Что ты хочешь узнать обо мне? 💜', sub: 'Задай вопрос анонимно — я отвечу', link },
  ];
}

/** Свой вопрос аудитории: «Ответь анонимно» */
export const askVariants = (question: string, link: string) => [
  { label: 'Ответь анонимно 🤫', headline: `«${question}»`, sub: 'Я не узнаю, кто ответил', link },
  { label: 'Вопрос для тебя', headline: `«${question}»`, sub: 'Ответ займёт минуту — и он анонимный 👀', link },
];

export { renderInviteCard };

/** Ответ на анонимный вопрос: вопрос в фиолетовой плашке, ответ крупно, внизу — QR «задай мне вопрос» */
export async function renderAnswerCard(input: { question: string; answer: string; link: string }): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const x = 90;
  const inner = W - x * 2;
  const padQ = 48;

  // Подбираем размеры, чтобы всё влезло в центральную зону (сверху и снизу — интерфейс Instagram/Telegram)
  const zoneTop = 300;
  const zoneBottom = H - 560;
  let qSize = 52;
  let aSize = 72;
  let q = fit(ctx, input.question, inner - padQ * 2, [52, 48, 44, 40, 36], 5, 700);
  let a = { size: aSize, lines: [] as string[] };
  for (const size of [76, 68, 60, 54, 48, 44, 40, 36, 32]) {
    q = fit(ctx, input.question, inner - padQ * 2, [Math.min(52, Math.round(size * 0.75)), 44, 40, 36], 5, 700);
    ctx.font = `600 ${size}px ${FONT}`;
    const lines = wrap(ctx, input.answer, inner);
    const h = 60 + padQ * 2 + q.lines.length * Math.round(q.size * 1.25) + 56 + lines.length * Math.round(size * 1.3);
    a = { size, lines };
    if (h <= zoneBottom - zoneTop) break;
  }
  qSize = q.size;
  aSize = a.size;
  const qLH = Math.round(qSize * 1.25);
  const aLH = Math.round(aSize * 1.3);
  const maxA = Math.max(1, Math.floor((zoneBottom - zoneTop - 60 - padQ * 2 - q.lines.length * qLH - 56) / aLH));
  if (a.lines.length > maxA) {
    a.lines = a.lines.slice(0, maxA);
    a.lines[maxA - 1] = `${a.lines[maxA - 1].replace(/\s*\S*$/, '')}…`;
  }
  const qBoxH = padQ * 2 + q.lines.length * qLH;
  const total = 60 + qBoxH + 56 + a.lines.length * aLH;
  let y = zoneTop + Math.max(0, Math.round((zoneBottom - zoneTop - total) / 2));

  // Метка
  ctx.font = `600 36px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  ctx.fillText('Анонимный вопрос 🤫', x, y);
  y += 60;

  // Вопрос
  roundRect(ctx, x, y, inner, qBoxH, 44);
  const grad = ctx.createLinearGradient(x, y, x + inner, y + qBoxH);
  grad.addColorStop(0, '#7c3aed');
  grad.addColorStop(1, '#a855f7');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.font = `700 ${qSize}px ${FONT}`;
  ctx.fillStyle = '#fff';
  let ty = y + padQ;
  for (const line of q.lines) {
    ctx.fillText(line, x + padQ, ty);
    ty += qLH;
  }
  y += qBoxH + 56;

  // Ответ
  ctx.font = `600 ${aSize}px ${FONT}`;
  ctx.fillStyle = '#fff';
  for (const line of a.lines) {
    ctx.fillText(line, x, y);
    y += aLH;
  }

  // Низ: QR + «задай мне вопрос» + ненавязчивый логотип
  const qr = 220;
  const qrY = H - 150 - qr;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, input.link, { margin: 1, width: qr - 30, color: { dark: '#000000', light: '#ffffff' } });
  roundRect(ctx, x, qrY, qr, qr, 28);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.drawImage(qrCanvas, x + 15, qrY + 15, qr - 30, qr - 30);
  const tx = x + qr + 40;
  const cta = fit(ctx, 'Задай мне вопрос анонимно', W - tx - 80, [44, 40, 36], 2, 700);
  ctx.font = `700 ${cta.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  let cy = qrY + 20;
  for (const line of cta.lines) {
    ctx.fillText(line, tx, cy);
    cy += Math.round(cta.size * 1.2);
  }
  ctx.font = `700 40px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('hush', tx, cy + 22);
  const w = ctx.measureText('hush').width;
  ctx.fillStyle = '#A855F7';
  ctx.fillText('.', tx + w, cy + 22);
  return canvas;
}
