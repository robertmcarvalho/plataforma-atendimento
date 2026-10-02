import PizZip from 'pizzip';

/**
 * Remove blobs VML embutidos (o:gfxdata) que incham document.xml (~5 MB) e quebram LibreOffice/Gotenberg.
 * Mantém layout via imagens em word/media e desenhos DrawingML; só elimina payload duplicado no XML.
 */
export function slimDocxXml(xml: string): string {
  return xml.replace(/\s*o:gfxdata="[^"]*"/g, '');
}

export function slimDocxBuffer(docx: Buffer): Buffer {
  const zip = new PizZip(docx);
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d+|footer\d+)\.xml$/.test(name)) continue;
    const file = zip.file(name);
    if (!file) continue;
    const text = file.asText();
    if (!text.includes('gfxdata') && !text.includes('mc:Fallback')) continue;
    zip.file(name, slimDocxXml(text));
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
