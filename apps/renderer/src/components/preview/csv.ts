/** CSV/TSV 解析与预览工具。 */

const DELIMITER_CANDIDATES = [',', '\t', ';'];

/**
 * RFC 4180 风格分隔文本解析：支持引号包裹字段、字段内换行、转义引号（""）；返回二维字符串数组。
 * 传入 `delimiter` 可强制分隔符，否则按首行自动探测（逗号 / 制表符 / 分号取其一）。
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // 去 BOM
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += src[i + 1] === '\n' ? 2 : 1; // CRLF 或孤立 CR 均视为行结束
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 取首行中出现次数最多的候选分隔符作为分隔符。 */
export function detectDelimiter(text: string): string {
  const lineEnd = text.search(/\r?\n/);
  const firstLine = lineEnd === -1 ? text : text.slice(0, lineEnd);
  let best = ',';
  let bestCount = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}
