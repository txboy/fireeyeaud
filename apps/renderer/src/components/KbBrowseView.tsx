import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Info, RefreshCw, Save, Search } from 'lucide-react';
import type { KbEnabledEntry } from '@fireeyeaud/shared';
import { useKnowledgeStore } from '../store/knowledge';
import { useUiStore, type KbBrowseTab } from '../store/ui';

/**
 * 「知识库浏览」tab：展示某 Provider 的远端知识库并勾选启用。
 * 交互对齐数据库的「表授权」页——左侧面板按钮打开，勾选后统一保存。
 */
export function KbBrowseView({ tab }: { tab: KbBrowseTab }) {
  const { t } = useTranslation('knowledge');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');

  const knowledgeByProvider = useKnowledgeStore((s) => s.knowledgeByProvider);
  const enabled = useKnowledgeStore((s) => s.enabled);
  const loadKnowledge = useKnowledgeStore((s) => s.loadKnowledge);
  const setEnabled = useKnowledgeStore((s) => s.setEnabled);
  const errorKey = useKnowledgeStore((s) => s.errorKey);
  const openKbQuery = useUiStore((s) => s.openKbQuery);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const remote = knowledgeByProvider[tab.providerId];

  const load = async () => {
    setLoading(true);
    setSaved(false);
    setDraft({});
    try {
      await loadKnowledge(tab.providerId, tab.scope);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 切换 Provider / 作用域时重新读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.providerId, tab.scope]);

  const enabledMap = new Map(
    enabled
      .filter((e) => e.providerId === tab.providerId && e.scope === tab.scope)
      .map((e) => [e.knowledgeId, e.enabled]),
  );

  const isOn = (knowledgeId: string) =>
    draft[knowledgeId] ?? enabledMap.get(knowledgeId) ?? false;

  const toggle = (knowledgeId: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [knowledgeId]: !isOn(knowledgeId) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      // 以当前作用域下的启用集为基础，合并本 Provider 的勾选结果。
      const base = new Map<string, KbEnabledEntry>(
        enabled
          .filter((e) => e.scope === tab.scope)
          .map((e) => [`${e.providerId}:${e.knowledgeId}`, { ...e }]),
      );
      for (const kb of remote ?? []) {
        base.set(`${tab.providerId}:${kb.id}`, {
          providerId: tab.providerId,
          knowledgeId: kb.id,
          name: kb.name,
          scope: tab.scope,
          enabled: isOn(kb.id),
        });
      }
      await setEnabled(tab.scope, [...base.values()]);
      setDraft({});
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const count = (remote ?? []).filter((kb) => isOn(kb.id)).length;

  return (
    <div className="kbbrowse">
      <div className="kbbrowse__bar">
        <BookOpen size={14} strokeWidth={1.75} color="var(--accent)" />
        <span className="kbbrowse__name">{tab.name}</span>
        <span className="scope-badge">{t('remoteKb')}</span>
        <span className="spacer" />
        <span className="card__meta">{t('enabledCount', { count })}</span>
        <button
          type="button"
          className="button button--sm button--ghost"
          onClick={() => void load()}
          disabled={loading || saving}
        >
          <RefreshCw size={12} strokeWidth={2} /> {t('refresh')}
        </button>
        <button
          type="button"
          className="button button--sm"
          onClick={() => void save()}
          disabled={saving || loading || !remote}
        >
          <Save size={12} strokeWidth={2} /> {t('save')}
        </button>
      </div>

      {errorKey && (
        <div className="panel-error kbbrowse__msg">
          {terr(errorKey.replace(/^error\./, ''))}
        </div>
      )}
      {saved && !errorKey && <div className="kbbrowse__saved">{tc('save')} ✓</div>}

      <div className="kbbrowse__body">
        {loading && !remote ? (
          <div className="panel-empty">
            <span>{tc('loading')}</span>
          </div>
        ) : !remote || remote.length === 0 ? (
          <div className="panel-empty">
            <BookOpen size={22} strokeWidth={1.5} />
            <span>{t('browseEmpty')}</span>
          </div>
        ) : (
          <div className="kbbrowse__list">
            {remote.map((kb) => (
              <div key={kb.id} className="kbbrowse__item">
                <label className="kbbrowse__item-main">
                  <input
                    type="checkbox"
                    checked={isOn(kb.id)}
                    disabled={saving}
                    onChange={() => toggle(kb.id)}
                  />
                  <span className="kbbrowse__item-name">{kb.name}</span>
                  {kb.documentCount !== undefined && (
                    <span className="card__meta">
                      {t('documents', { count: kb.documentCount })}
                    </span>
                  )}
                </label>
                <span className="spacer" />
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  onClick={() =>
                    void openKbQuery({
                      id: tab.providerId,
                      scope: tab.scope,
                      name: tab.name,
                      knowledgeId: kb.id,
                      knowledgeName: kb.name,
                    })
                  }
                >
                  <Search size={13} strokeWidth={1.9} /> {t('queryTest')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kbbrowse__note">
        <div className="note">
          <Info size={14} strokeWidth={1.75} />
          <span>{t('egress')}</span>
        </div>
      </div>
    </div>
  );
}
