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

/**
 * Одна карточка с несколькими ответами одного анонима (1–5): каждый ответ — своим блоком,
 * шрифт подбирается так, чтобы всё влезло между заголовком и QR.
 */
export async function renderMultiStoryCard(input: { items: Array<{ question: string; answer: string }>; link: string; handle: string }) {
  if (input.items.length === 1) return renderStoryCard({ ...input.items[0], link: input.link, handle: input.handle });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  ctx.font = `700 84px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('hush', 90, 130);
  const logoW = ctx.measureText('hush').width;
  ctx.fillStyle = '#A855F7';
  ctx.fillText('.', 90 + logoW, 130);
  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  ctx.fillText('Мне ответили анонимно 👀', 90, 270);

  const n = input.items.length;
  const cardX = 70;
  const cardW = W - 140;
  const pad = n > 3 ? 34 : 44;
  const inner = cardW - pad * 2;
  const gap = n > 3 ? 18 : 24;
  const qaGap = 12;
  const top = 360;
  const bottom = H - 150 - 300 - 60;
  const available = bottom - top - gap * (n - 1) - pad * 2 * n;

  type Laid = { q: string[]; a: string[] };
  const layout = (aSize: number, maxALines = 99): { laid: Laid[]; height: number; qSize: number } => {
    const qSize = Math.max(24, Math.round(aSize * 0.62));
    let height = 0;
    const laid = input.items.map((it) => {
      ctx.font = `500 ${qSize}px ${FONT}`;
      const q = wrap(ctx, it.question, inner).slice(0, 2);
      ctx.font = `700 ${aSize}px ${FONT}`;
      let a = wrap(ctx, `«${it.answer}»`, inner);
      if (a.length > maxALines) {
        a = a.slice(0, maxALines);
        a[maxALines - 1] = `${a[maxALines - 1].replace(/\s*\S*$/, '')}…»`;
      }
      height += q.length * Math.round(qSize * 1.3) + qaGap + a.length * Math.round(aSize * 1.25);
      return { q, a };
    });
    return { laid, height, qSize };
  };

  const sizes = [60, 54, 48, 44, 40, 36, 33, 30, 28];
  let aSize = sizes[sizes.length - 1];
  let res = layout(aSize);
  for (const size of sizes) {
    const r = layout(size);
    if (r.height <= available) {
      aSize = size;
      res = r;
      break;
    }
  }
  // Даже мелким шрифтом не влезает — укорачиваем длинные ответы поровну
  for (let lines = 6; res.height > available && lines >= 1; lines--) res = layout(aSize, lines);

  const totalH = res.height + pad * 2 * n + gap * (n - 1);
  let y = top + Math.max(0, Math.round((bottom - top - totalH) / 2));
  const qLH = Math.round(res.qSize * 1.3);
  const aLH = Math.round(aSize * 1.25);
  for (const block of res.laid) {
    const h = pad * 2 + block.q.length * qLH + qaGap + block.a.length * aLH;
    roundRect(ctx, cardX, y, cardW, h, 40);
    ctx.fillStyle = '#17101f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#6a45a0';
    ctx.stroke();
    let ty = y + pad;
    ctx.font = `500 ${res.qSize}px ${FONT}`;
    ctx.fillStyle = '#a1a1aa';
    for (const line of block.q) {
      ctx.fillText(line, cardX + pad, ty);
      ty += qLH;
    }
    ty += qaGap;
    ctx.font = `700 ${aSize}px ${FONT}`;
    ctx.fillStyle = '#fff';
    for (const line of block.a) {
      ctx.fillText(line, cardX + pad, ty);
      ty += aLH;
    }
    y += h + gap;
  }

  // Низ: QR + призыв — как на одиночной карточке
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
  const cta = fit(ctx, 'Узнай, что думают о тебе твои друзья 👀', W - textX - 80, [50, 46, 42], 3, 700);
  ctx.font = `700 ${cta.size}px ${FONT}`;
  ctx.fillStyle = '#fff';
  const ctaLH = Math.round(cta.size * 1.22);
  let cy = qrY + 10;
  for (const line of cta.lines) {
    ctx.fillText(line, textX, cy);
    cy += ctaLH;
  }
  ctx.font = `500 38px ${FONT}`;
  ctx.fillStyle = '#B987FF';
  ctx.fillText(input.handle, textX, cy + 24);
  return canvas;
}
