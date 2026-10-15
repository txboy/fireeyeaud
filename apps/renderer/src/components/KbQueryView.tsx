import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Search } from 'lucide-react';
import type { KbQueryResult } from '@fireeyeaud/shared';
import { useKnowledgeStore } from '../store/knowledge';
import type { KbQueryTab } from '../store/ui';

/**
 * 「检索测试」tab：先选定该连接下的某个知识库（库），再输入检索文本提交，
 * 下方展示该库返回的命中片段与耗时。不落盘、不写证据。
 */
export function KbQueryView({ tab }: { tab: KbQueryTab }) {
  const { t } = useTranslation('knowledge');
  const { t: terr } = useTranslation('error');

  const query = useKnowledgeStore((s) => s.query);
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge);
  const knowledgeByProvider = useKnowledgeStore((s) => s.knowledgeByProvider);
  const errorKey = useKnowledgeStore((s) => s.errorKey);
  const queryError = useKnowledgeStore((s) => s.queryError);

  const remote = knowledgeByProvider[tab.providerId];

  const [selected, setSelected] = useState(tab.knowledgeId ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KbQueryResult | null>(null);

  useEffect(() => {
    if (!tab.knowledgeId) {
      setSelected('');
    }
    void loadKnowledge(tab.providerId, tab.scope);
    // 仅按 Provider / 作用域 / 预选库切换时重载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.providerId, tab.scope, tab.knowledgeId]);

  // 未显式指定库时，默认选中第一个远端库。
  const effective = selected || (remote && remote.length ? remote[0].id : '');
  const knownName =
    tab.knowledgeName ||
    remote?.find((kb) => kb.id === effective)?.name ||
    effective;

  const submit = async () => {
    const q = text.trim();
    if (!q || busy || !effective) return;
    setBusy(true);
    try {
      const res = await query(tab.providerId, {
        query: q,
        scope: tab.scope,
        knowledgeIds: [effective],
      });
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kbquery">
      <div className="kbquery__bar">
        <Search size={14} strokeWidth={1.75} color="var(--accent)" />
        <span className="kbquery__name">{tab.name}</span>
        <span className="scope-badge">{t('queryTest')}</span>
        <span className="spacer" />
        <label className="kbquery__target">
          <span className="card__meta">{t('queryTarget')}</span>
          <select
            className="searchbox kbquery__select"
            value={effective}
            disabled={!remote || remote.length === 0}
            onChange={(e) => {
              setSelected(e.target.value);
              setResult(null);
            }}
          >
            {!remote || remote.length === 0 ? (
              <option value="">{t('queryNoRemote')}</option>
            ) : (
              remote.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="kbquery__input">
        <textarea
          className="searchbox kbquery__text"
          placeholder={t('queryPlaceholder')}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="kbquery__actions">
          <span className="card__meta">{t('queryHint')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button button--sm"
            disabled={busy || !text.trim() || !effective}
            onClick={() => void submit()}
          >
            <Search size={13} strokeWidth={1.9} />{' '}
            {busy ? t('querying') : t('querySubmit')}
          </button>
        </div>
      </div>

      {errorKey && (
        <div className="panel-error kbquery__msg">
          <div>{terr(errorKey.replace(/^error\./, ''))}</div>
          {queryError && <div className="kbquery__reason">{queryError}</div>}
        </div>
      )}

      <div className="kbquery__body">
        {result && (
          <div className="kbquery__meta">
            <Clock size={12} strokeWidth={1.9} />
            <span>{t('queryElapsed', { ms: result.elapsedMs })}</span>
            <span className="spacer" />
            <span>{t('queryHits', { count: result.hits.length })}</span>
          </div>
        )}

        {!result ? (
          <div className="panel-empty">
            <Search size={22} strokeWidth={1.5} />
            <span>{t('queryEmpty', { name: knownName })}</span>
          </div>
        ) : result.hits.length === 0 ? (
          <div className="panel-empty">
            <span>{t('queryNoHits')}</span>
          </div>
        ) : (
          <div className="kbquery__hits">
            {result.hits.map((hit, index) => (
              <div key={index} className="kbquery__hit">
                <div className="kbquery__hit-head">
                  <span className="kbquery__hit-doc">
                    {hit.docName || hit.knowledgeName || t('queryHit')}
                  </span>
                  <span className="spacer" />
                  {hit.score != null && (
                    <span className="card__meta">
                      {t('queryScore', { score: hit.score.toFixed(3) })}
                    </span>
                  )}
                </div>
                <div className="kbquery__hit-body">{hit.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
