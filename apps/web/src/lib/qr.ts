import { qrcodegen } from '@/lib/qrcodegen';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function qrCodeSvg(text: string, { border = 4, scale = 4 }: { border?: number; scale?: number } = {}) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size;
  const dim = (size + border * 2) * scale;

  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.getModule(x, y)) continue;
      const rx = (x + border) * scale;
      const ry = (y + border) * scale;
      rects += `<rect x="${rx}" y="${ry}" width="${scale}" height="${scale}"/>`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="white"/>` +
    `<g fill="black">${rects}</g>` +
    `<title>${esc(text)}</title>` +
    `</svg>`
  );
}

