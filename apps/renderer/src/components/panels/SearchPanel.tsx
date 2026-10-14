import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSpreadsheet, FileText, Loader2, SearchX } from 'lucide-react';
import type { SearchResult } from '@fireeyeaud/shared';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';

const SPREADSHEET_EXT = new Set(['.xlsx', '.xlsm', '.xls', '.csv']);

function iconFor(filePath: string) {
  const dot = filePath.lastIndexOf('.');
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return SPREADSHEET_EXT.has(ext) ? FileSpreadsheet : FileText;
}

/** 把搜索结果里的相对路径（`/` 分隔）拼成绝对路径。 */
function joinPath(root: string, relPath: string) {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${relPath.split('/').join(sep)}`;
}

export function SearchPanel() {
  const { t } = useTranslation('search');
  const { t: te } = useTranslation('error');
  const root = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);

  const [query, setQuery] = useState('');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!root || !query.trim()) {
      setResult(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await window.fireeyeaud?.searchRun({
            root,
            query,
            options: { include, exclude, regex, caseSensitive },
          });
          setResult(res ?? { files: [], total: 0 });
          setError(false);
        } catch {
          setError(true);
          setResult(null);
        } finally {
          setLoading(false);
        }
      })();
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [root, query, include, exclude, regex, caseSensitive]);

  return (
    <>
      <input
        className="searchbox"
        placeholder={t('placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="field">
        <span className="field__label">{t('include')}</span>
        <input
          className="searchbox"
          value={include}
          onChange={(e) => setInclude(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field__label">{t('exclude')}</span>
        <input
          className="searchbox"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
      </div>
      <div className="search-opts">
        <label className="search-opt">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          <span>{t('caseSensitive')}</span>
        </label>
        <label className="search-opt">
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
          />
          <span>{t('regex')}</span>
        </label>
      </div>

      {loading ? (
        <div className="sidebar__subtitle">
          <Loader2 size={13} strokeWidth={1.75} className="spin" />
        </div>
      ) : result ? (
        <div className="sidebar__subtitle">
          {t('resultSummary', {
            files: result.files.length,
            matches: result.total,
          })}
        </div>
      ) : null}

      {error && <span className="panel-error">{te('internal')}</span>}
      {!root && <span className="panel-error">{t('noResults')}</span>}

      {result && result.files.length === 0 && !loading && (
        <div className="panel-empty">
          <SearchX size={20} strokeWidth={1.5} />
          <span>{t('noResults')}</span>
        </div>
      )}

      {result?.files.map((group) => {
        const Icon = iconFor(group.path);
        const absPath = root ? joinPath(root, group.path) : group.path;
        const name = group.path.split('/').pop() ?? group.path;
        const open = (target?: { line?: number; column?: number }) => {
          if (root) openPreview(root, absPath, name, target);
        };
        return (
          <div key={group.path} className="tree">
            <div
              className="tree__row tree__row--folder"
              onClick={() => open()}
              title={group.path}
            >
              <Icon size={14} strokeWidth={1.75} />
              <span>{group.path}</span>
            </div>
            {group.matches.map((hit) => (
              <div
                key={`${group.path}:${hit.line}:${hit.column}`}
                className="tree__row"
                style={{ paddingLeft: 22 }}
                title={hit.text}
                onClick={() => open({ line: hit.line, column: hit.column })}
              >
                <span
                  className="mono"
                  style={{ color: 'var(--text-3)', width: 30, textAlign: 'right' }}
                >
                  {hit.line}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {hit.text}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
