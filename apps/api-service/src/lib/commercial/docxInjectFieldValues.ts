import PizZip from 'pizzip';

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Índice do último <w:r …> antes de pos (não confunde com <w:rPr>). */
function lastRunStartBefore(xml: string, beforeIdx: number): number {
  const re = /<w:r[\s/>]/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && m.index < beforeIdx) {
    last = m.index;
  }
  return last;
}

/** middle = XML do separate até antes do fldChar end; remove runs de exibição antigos. */
function replaceFieldDisplayMiddle(middle: string, escaped: string): string {
  const sepPos = middle.indexOf('w:fldCharType="separate"');
  if (sepPos < 0) return middle;

  const closeRun = middle.indexOf('</w:r>', sepPos);
  if (closeRun < 0) return middle;

  const prefix = middle.slice(0, closeRun + '</w:r>'.length);
  const displayRun =
    `<w:r><w:rPr><w:noProof/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
  return prefix + displayRun;
}

/** Remove ",00" estático logo após o fim do campo quando o valor já traz centavos. */
function stripOrphanCentSuffix(xml: string, fromIdx: number): string {
  const tail = xml.slice(fromIdx, fromIdx + 500);
  const m = tail.match(
    /^[\s\S]*?<\/w:r>\s*<w:r[^>]*>[\s\S]*?<w:t>,00<\/w:t>\s*<\/w:r>/,
  );
  if (!m) return xml;
  return xml.slice(0, fromIdx) + xml.slice(fromIdx + m[0].length);
}

const CURRENCY_FIELD_TAGS = new Set([
  'SETUP',
  'MINIMO_GARANTIDO',
  'TAXA_1',
  'VALOR_DIARIA',
]);

/**
 * Substitui o texto exibido dos campos Word (entre separate e end) sem alterar a estrutura do DOCX.
 * Tags vêm de w:instrText ({NOME_FANTASIA}) ou MERGEFIELD convertido.
 */
export function injectMergeFieldDisplayValues(xml: string, values: Record<string, string>): string {
  let result = xml;
  let searchFrom = 0;

  while (searchFrom < result.length) {
    const beginIdx = result.indexOf('w:fldCharType="begin"', searchFrom);
    if (beginIdx < 0) break;

    const instrIdx = result.indexOf('instrText', beginIdx);
    if (instrIdx < 0 || instrIdx > beginIdx + 4000) {
      searchFrom = beginIdx + 20;
      continue;
    }

    const instrSlice = result.slice(instrIdx, instrIdx + 320);
    const tagMatch =
      instrSlice.match(/\{([A-Z0-9_]+)\}/) ??
      instrSlice.match(/MERGEFIELD\s+"?([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇa-z0-9_]+)"?/i);
    if (!tagMatch) {
      searchFrom = beginIdx + 20;
      continue;
    }

    const rawTag = tagMatch[1]
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/\s+/g, '_');
    const value = values[rawTag];
    if (value == null) {
      searchFrom = beginIdx + 20;
      continue;
    }

    const sepIdx = result.indexOf('w:fldCharType="separate"', instrIdx);
    const endIdx = sepIdx >= 0 ? result.indexOf('w:fldCharType="end"', sepIdx) : -1;
    if (sepIdx < 0 || endIdx < 0) {
      searchFrom = beginIdx + 20;
      continue;
    }

    const endRunStart = lastRunStartBefore(result, endIdx);
    if (endRunStart < sepIdx) {
      searchFrom = beginIdx + 20;
      continue;
    }

    const head = result.slice(0, sepIdx);
    const tail = result.slice(endRunStart);
    let middle = result.slice(sepIdx, endRunStart);
    const escaped = escapeXmlText(value);

    middle = replaceFieldDisplayMiddle(middle, escaped);
    result = head + middle + tail;

    let advance = head.length + middle.length;
    if (CURRENCY_FIELD_TAGS.has(rawTag) && /,\d{2}$/.test(value)) {
      result = stripOrphanCentSuffix(result, advance);
    }
    searchFrom = advance;
  }

  return result;
}

export function injectValuesIntoDocxZip(zip: PizZip, values: Record<string, string>): PizZip {
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d+|footer\d+)\.xml$/.test(name)) continue;
    const file = zip.file(name);
    if (!file) continue;
    const text = file.asText();
    if (!text.includes('fldChar') && !text.includes('instrText')) continue;
    zip.file(name, injectMergeFieldDisplayValues(text, values));
  }
  return zip;
}
