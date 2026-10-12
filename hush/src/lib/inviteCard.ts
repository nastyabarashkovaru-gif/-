/**
 * Сторис-приглашение ответить на анкету (1080×1920).
 * Всё содержимое — в центре, сверху и снизу свободные поля под интерфейс Instagram/Telegram.
 * QR ведёт прямо на анкету пользователя.
 */
import QRCode from 'qrcode';
import { fit, FONT, H, roundRect, W } from './storyCard';

export interface InviteCardInput {
  /** Маленькая фиолетовая надпись над заголовком (необязательно) */
  label?: string;
  headline: string;
  sub: string;
  link: string;
}

export async function renderInviteCard(input: InviteCardInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const cardW = 860;
  const pad = 64;
  const inner = cardW - pad * 2;

  // Замеры блоков, чтобы собрать всё в центре
  const logoH = 80;
  const label = input.label ? fit(ctx, input.label, inner, [38], 1, 600) : null;
  const head = fit(ctx, input.headline, inner, [78, 70, 62, 56, 50], 5, 700);
  const headLH = Math.round(head.size * 1.18);
  const sub = fit(ctx, input.sub, inner, [38, 34], 3, 500);
  const subLH = Math.round(sub.size * 1.35);
  const qr = 300;
  const caption = { size: 34, lines: ['Наведи камеру на QR', 'или перейди по ссылке'] };
  const captionLH = Math.round(caption.size * 1.3);
  // Личная ссылка — текстом, её можно переписать или распознать со скриншота.
  // В одну строку; если не влезает — перенос перед «?startapp», а не посреди кода анкеты
  const linkText = input.link.replace(/^https?:\/\//, '');
  const linkFit = { size: 26, lines: linkText.replace('?', '\n?').split('\n') };
  for (const size of [34, 32, 30, 28]) {
    ctx.font = `700 ${size}px ${FONT}`;
    if (ctx.measureText(linkText).width <= inner) {
      Object.assign(linkFit, { size, lines: [linkText] });
      break;
    }
  }
  const linkLH = Math.round(linkFit.size * 1.3);
  const captionH = caption.lines.length * captionLH + 22 + linkFit.lines.length * linkLH;

  const cardH =
    pad + (label ? 38 + 28 : 0) + head.lines.length * headLH + 30 + sub.lines.length * subLH + 52 + qr + 28 + captionH + pad;
  const blockH = logoH + 56 + cardH;
  let y = Math.round((H - blockH) / 2);

  // Логотип
  ctx.font = `700 80px ${FONT}`;
  const logoW = ctx.measureText('hush.').width;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.fillText('hush', cx - logoW / 2, y);
  ctx.fillStyle = '#A855F7';
  ctx.fillText('.', cx - logoW / 2 + ctx.measureText('hush').width, y);
  ctx.textAlign = 'center';
  y += logoH + 56;

  // Карточка
  const cardX = (W - cardW) / 2;
  roundRect(ctx, cardX, y, cardW, cardH, 56);
  ctx.fillStyle = '#17101f';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#6a45a0';
  ctx.stroke();
  y += pad;

  if (label) {
    ctx.font = `600 38px ${FONT}`;
    ctx.fillStyle = '#B987FF';
    ctx.fillText(label.lines[0], cx, y);
    y += 38 + 28;
  }

  ctx.font = `700 ${head.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  for (const line of head.lines) {
    ctx.fillText(line, cx, y);
    y += headLH;
  }
  y += 30;

  ctx.font = `500 ${sub.size}px ${FONT}`;
  ctx.fillStyle = '#a1a1aa';
  for (const line of sub.lines) {
    ctx.fillText(line, cx, y);
    y += subLH;
  }
  y += 52;

  // QR на анкету
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, input.link, { margin: 1, width: qr - 40, color: { dark: '#000000', light: '#ffffff' } });
  roundRect(ctx, cx - qr / 2, y, qr, qr, 36);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.drawImage(qrCanvas, cx - qr / 2 + 20, y + 20, qr - 40, qr - 40);
  y += qr + 28;

  ctx.font = `600 ${caption.size}px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  for (const line of caption.lines) {
    ctx.fillText(line, cx, y);
    y += captionLH;
  }
  y += 22;
  ctx.font = `700 ${linkFit.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  for (const line of linkFit.lines) {
    ctx.fillText(line, cx, y);
    y += linkLH;
  }

  return canvas;
}

/** Три варианта приглашения; для второго берём самый «острый» вопрос анкеты */
export function inviteVariants(questions: string[], link: string): InviteCardInput[] {
  const spicy =
    questions.find((q) => /бесит|в лицо|завидуешь|правду|отталкивает/i.test(q)) ?? questions[0] ?? 'Что ты на самом деле думаешь обо мне?';
  return [
    {
      headline: 'Ответь анонимно на 5 вопросов обо мне 👀',
      sub: 'Можно говорить всё, что думаешь — я не узнаю, кто ответил',
      link,
    },
    {
      label: 'Вопрос для тебя',
      headline: `«${spicy}»`,
      sub: 'Ответь анонимно — я не узнаю, кто это написал 👀',
      link,
    },
    {
      headline: 'Скажи мне то, что никогда не говорил(а) в лицо 🤫',
      sub: '5 анонимных вопросов обо мне. Это займёт минуту',
      link,
    },
  ];
}
