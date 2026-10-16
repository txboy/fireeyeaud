import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDelimited } from './csv';

const MAX_ROWS = 500;
const MAX_COLS = 50;

/** CSV/TSV 预览：解析为表格，首行作表头，超限截断（与 xlsx 预览一致的上限）。 */
export function CsvPreview({ text, delimiter }: { text: string; delimiter?: string }) {
  const { t } = useTranslation('preview');

  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1, MAX_ROWS + 1);
  const totalRows = Math.max(rows.length - 1, 0);
  const totalCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const cols = Math.min(totalCols, MAX_COLS);
  const truncated = totalRows > MAX_ROWS || totalCols > MAX_COLS;

  return (
    <div className="sheetpreview">
      {truncated && (
        <div className="preview-status">
          <span className="panel-hint">
            {t('truncated', {
              rows: Math.min(totalRows, MAX_ROWS),
              cols: Math.min(totalCols, MAX_COLS),
            })}
          </span>
        </div>
      )}
      <div className="sheetpreview__grid">
        <table className="sheet sheet--csv">
          {rows.length > 0 && (
            <thead>
              <tr>
                <th className="sheet__rowno" />
                {Array.from({ length: cols }).map((_, colIndex) => (
                  <th key={colIndex}>{header[colIndex] ?? ''}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {dataRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sheet__rowno">{rowIndex + 1}</th>
                {Array.from({ length: cols }).map((_, colIndex) => (
                  <td key={colIndex}>{row[colIndex] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
