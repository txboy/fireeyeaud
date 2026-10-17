import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import ExcelJS from 'exceljs';
import { base64ToBytes } from './util';
import { CopyButton } from '../CopyButton';

const MAX_ROWS = 500;
const MAX_COLS = 50;

interface SheetData {
  name: string;
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((r) => r.text).join('');
    }
    if (typeof v.text === 'string') return v.text;
    if ('result' in v) return v.result == null ? '' : String(v.result);
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(value);
}

/** Excel（.xlsx/.xlsm）预览：逐工作表渲染为表格，超限截断。 */
export function SpreadsheetPreview({ data }: { data: string }) {
  const { t } = useTranslation('preview');
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      try {
        const workbook = new ExcelJS.Workbook();
        const bytes = base64ToBytes(data);
        const buffer = bytes.buffer as Parameters<ExcelJS.Xlsx['load']>[0];
        await workbook.xlsx.load(buffer);
        const out: SheetData[] = workbook.worksheets.map((sheet) => {
          const totalRows = sheet.rowCount;
          const totalCols = sheet.columnCount;
          const cols = Math.min(totalCols, MAX_COLS);
          const rows: string[][] = [];
          sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > MAX_ROWS) return;
            const cells: string[] = [];
            for (let c = 1; c <= cols; c += 1) cells.push(cellText(row.getCell(c).value));
            rows[rowNumber - 1] = cells;
          });
          return { name: sheet.name, rows, totalRows, totalCols };
        });
        if (!cancelled) {
          setSheets(out);
          setActive(0);
          setStatus('ok');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  const current = sheets[active];
  const truncated =
    current && (current.totalRows > MAX_ROWS || current.totalCols > MAX_COLS);

  return (
    <div className="sheetpreview">
      {status === 'loading' && (
        <div className="preview-status">
          <Loader2 size={14} strokeWidth={2} className="spin" />
          <span>{t('loading')}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="preview-status">
          <span className="panel-error">{t('parseFailed')}</span>
        </div>
      )}
      {status === 'ok' && (
        <>
          <div className="preview-toolbar">
            <CopyButton
              title={t('copyTable')}
              text={() =>
                current ? current.rows.map((row) => row.join('\t')).join('\n') : ''
              }
            />
          </div>
          {sheets.length > 1 && (
            <div className="sheetpreview__tabs">
              {sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  type="button"
                  className={`sheetpreview__tab${index === active ? ' sheetpreview__tab--active' : ''}`}
                  onClick={() => setActive(index)}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}
          {truncated && current && (
            <div className="preview-status">
              <span className="panel-hint">
                {t('truncated', {
                  rows: Math.min(current.totalRows, MAX_ROWS),
                  cols: Math.min(current.totalCols, MAX_COLS),
                })}
              </span>
            </div>
          )}
          <div className="sheetpreview__grid">
            <table className="sheet">
              <tbody>
                {(current?.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <th className="sheet__rowno">{rowIndex + 1}</th>
                    {Array.from({ length: Math.min(current?.totalCols ?? 0, MAX_COLS) }).map(
                      (_, colIndex) => (
                        <td key={colIndex}>{row[colIndex] ?? ''}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
