import { useTranslation } from 'react-i18next';
import { File as FileIcon, MessageSquare, X } from 'lucide-react';
import { useUiStore, type FormTab, type PreviewTab } from '../store/ui';
import { AgentColumn } from './AgentColumn';
import { ResultsColumn } from './ResultsColumn';
import { FilePreview } from './FilePreview';
import { FormTabView } from './FormTabView';
import { FORM_DOMAIN_ICON, useFormTitle } from './forms/meta';

/** 「会话」tab：对话栏 + 成果栏一体（左对话、右成果）。 */
function SessionView() {
  return (
    <div className="sessionview">
      <AgentColumn />
      <ResultsColumn />
    </div>
  );
}

/**
 * 右侧内容区：顶部为一等 tab 容器。
 * - 「会话」tab 常驻不可关闭；
 * - 「预览」tab（文件）/「配置表单」tab（数据库/MCP/Skills/Models）可多开、可关闭。
 */
export function RightArea() {
  const { t } = useTranslation('preview');
  const formTitle = useFormTitle();
  const tabs = useUiStore((s) => s.rightTabs);
  const activeId = useUiStore((s) => s.activeRightTabId);
  const activate = useUiStore((s) => s.activateRightTab);
  const closeTab = useUiStore((s) => s.closeRightTab);

  const active =
    tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? { id: 'session', kind: 'session' as const };

  return (
    <section className="rightarea">
      <div className="rightarea__tabs" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id;
          const Icon =
            tab.kind === 'session'
              ? MessageSquare
              : tab.kind === 'form'
                ? FORM_DOMAIN_ICON[tab.domain]
                : FileIcon;
          const label =
            tab.kind === 'session'
              ? t('sessionTab')
              : tab.kind === 'form'
                ? formTitle(tab)
                : tab.name;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`rightarea__tab${isActive ? ' rightarea__tab--active' : ''}`}
              title={tab.kind === 'preview' ? tab.path : label}
              onClick={() => void activate(tab.id)}
            >
              <Icon size={13} strokeWidth={1.75} />
              <span className="rightarea__tab-label">{label}</span>
              {tab.kind !== 'session' && (
                <button
                  type="button"
                  className="rightarea__tab-close"
                  title={t('closeTab')}
                  aria-label={t('closeTab')}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="rightarea__body">
        {active.kind === 'session' ? (
          <SessionView />
        ) : active.kind === 'form' ? (
          <FormTabView tab={active as FormTab} />
        ) : (
          <FilePreview target={active as PreviewTab} />
        )}
      </div>
    </section>
  );
}
