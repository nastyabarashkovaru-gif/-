/**
 * Картинка для сторис 1080×1920: вопрос, анонимный ответ, QR на бота и призыв.
 * Рисуется на canvas прямо на устройстве — ответы не уходят на сторонние сервисы.
 */
import QRCode from 'qrcode';

export const W = 1080;
export const H = 1920;
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Inter Variable", Arial, sans-serif';

export interface StoryCardInput {
  question: string;
  answer: string;
  /** Ссылка в QR-коде */
  link: string;
  /** Подпись под QR, например @Hush_miniapp_bot */
  handle: string;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Перенос по словам; длинные слова режутся посимвольно */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Подбирает размер шрифта, чтобы текст влез в заданное число строк */
export function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, sizes: number[], maxLines: number, weight: number) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines = wrap(ctx, text, maxWidth).slice(0, maxLines);
  lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`;
  return { size, lines };
}

export async function renderStoryCard(input: StoryCardInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'top';

  // Фон
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Логотип
  ctx.font = `700 84px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('hush', 90, 130);
  const logoW = ctx.measureText('hush').width;
  ctx.fillStyle = '#A855F7';
  ctx.fillText('.', 90 + logoW, 130);

  // Подзаголовок
  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  ctx.fillText('Мне ответили анонимно 👀', 90, 270);

  // Карточка с вопросом и ответом
  const cardX = 70;
  const cardW = W - 140;
  const pad = 64;
  const inner = cardW - pad * 2;

  const q = fit(ctx, input.question, inner, [46, 42, 38], 4, 500);
  const qLineH = Math.round(q.size * 1.3);

  // Карточка помещается между подзаголовком и блоком с QR: ответ уменьшается, пока не влезет
  const top = 380;
  const bottom = H - 150 - 300 - 90;
  const available = bottom - top;
  const sizes = [80, 72, 64, 58, 52, 46, 42, 38];
  let a = { size: sizes[sizes.length - 1], lines: [] as string[] };
  let aLineH = 0;
  let cardH = 0;
  for (const size of sizes) {
    const lineH = Math.round(size * 1.28);
    const maxLines = Math.max(1, Math.floor((available - pad * 2 - q.lines.length * qLineH - 48) / lineH));
    a = fit(ctx, `«${input.answer}»`, inner, [size], maxLines, 700);
    aLineH = lineH;
    cardH = pad + q.lines.length * qLineH + 48 + a.lines.length * aLineH + pad;
    ctx.font = `700 ${size}px ${FONT}`;
    if (wrap(ctx, `«${input.answer}»`, inner).length <= maxLines) break;
  }
  const cardY = top + Math.max(0, Math.round((available - cardH) / 2));

  roundRect(ctx, cardX, cardY, cardW, cardH, 56);
  ctx.fillStyle = '#17101f';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#6a45a0';
  ctx.stroke();

  let y = cardY + pad;
  ctx.font = `500 ${q.size}px ${FONT}`;
  ctx.fillStyle = '#a1a1aa';
  for (const line of q.lines) {
    ctx.fillText(line, cardX + pad, y);
    y += qLineH;
  }
  y += 48;
  ctx.font = `700 ${a.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  for (const line of a.lines) {
    ctx.fillText(line, cardX + pad, y);
    y += aLineH;
  }

  // Низ: QR + призыв
  const qrSize = 300;
  const qrX = 90;
  const qrY = H - 150 - qrSize;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, input.link, { margin: 1, width: qrSize - 40, color: { dark: '#000000', light: '#ffffff' } });
  roundRect(ctx, qrX, qrY, qrSize, qrSize, 36);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.drawImage(qrCanvas, qrX + 20, qrY + 20, qrSize - 40, qrSize - 40);

  const textX = qrX + qrSize + 56;
  const textW = W - textX - 80;
  const cta = fit(ctx, 'Узнай, что думают о тебе твои друзья 👀', textW, [50, 46, 42], 3, 700);
  ctx.font = `700 ${cta.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  const ctaLineH = Math.round(cta.size * 1.22);
  let ty = qrY + 10;
  for (const line of cta.lines) {
    ctx.fillText(line, textX, ty);
    ty += ctaLineH;
  }
  ctx.font = `500 38px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  ctx.fillText(input.handle, textX, ty + 24);

  return canvas;
}
