import { useTranslation } from 'react-i18next';
import { File as FileIcon, MessageSquare, Settings, X } from 'lucide-react';
import {
  useUiStore,
  type FormTab,
  type PreviewTab,
  type RightTab,
  type SessionTab,
} from '../store/ui';
import { useChatStore } from '../store/chat';
import { confirmStopSession } from '../lib/stop-guard';
import { AgentColumn } from './AgentColumn';
import { ResultsColumn } from './ResultsColumn';
import { FilePreview } from './FilePreview';
import { FormTabView } from './FormTabView';
import { SettingsPanel } from './panels/SettingsPanel';
import { FORM_DOMAIN_ICON, useFormTitle } from './forms/meta';

/** 「会话」tab：对话栏 + 成果栏一体（左对话、右成果）。 */
function SessionView({ sessionId }: { sessionId: string }) {
  return (
    <div className="sessionview">
      <AgentColumn sessionId={sessionId} />
      <ResultsColumn />
    </div>
  );
}

/**
 * 右侧内容区：顶部为一等 tab 容器。
 * - 「会话」tab：每个会话一个，可多开、可关闭；
 * - 「预览」tab（文件）/「配置表单」tab（数据库/MCP/Skills/Models）可多开、可关闭。
 */
export function RightArea() {
  const { t } = useTranslation('preview');
  const { t: te } = useTranslation('explorer');
  const { t: ts } = useTranslation('settings');
  const formTitle = useFormTitle();
  const tabs = useUiStore((s) => s.rightTabs);
  const activeId = useUiStore((s) => s.activeRightTabId);
  const activate = useUiStore((s) => s.activateRightTab);
  const closeTab = useUiStore((s) => s.closeRightTab);
  const sessions = useChatStore((s) => s.sessions);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const sessionLabel = (tab: SessionTab) => {
    const meta = sessions.find((s) => s.id === tab.sessionId);
    return meta?.title || te('untitledSession');
  };

  const labelOf = (tab: RightTab) =>
    tab.kind === 'session'
      ? sessionLabel(tab)
      : tab.kind === 'form'
        ? formTitle(tab)
        : tab.kind === 'settings'
          ? ts('title')
          : tab.name;

  const handleClose = async (tab: RightTab) => {
    // 关闭正在生成的会话 tab：先警告并中止生成（保留已生成部分）。
    if (tab.kind === 'session' && !(await confirmStopSession(tab.sessionId))) return;
    void closeTab(tab.id);
  };

  return (
    <section className="rightarea">
      <div className="rightarea__tabs" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active?.id;
          const Icon =
            tab.kind === 'session'
              ? MessageSquare
              : tab.kind === 'form'
                ? FORM_DOMAIN_ICON[tab.domain]
                : tab.kind === 'settings'
                  ? Settings
                  : FileIcon;
          const label = labelOf(tab);
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
              <button
                type="button"
                className="rightarea__tab-close"
                title={t('closeTab')}
                aria-label={t('closeTab')}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleClose(tab);
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="rightarea__body">
        {!active ? (
          <div className="panel-empty">
            <MessageSquare size={22} strokeWidth={1.5} />
            <span>{t('emptyArea')}</span>
          </div>
        ) : active.kind === 'session' ? (
          <SessionView sessionId={active.sessionId} />
        ) : active.kind === 'form' ? (
          <FormTabView tab={active as FormTab} />
        ) : active.kind === 'settings' ? (
          <div className="formtab">
            <div className="formtab__head">
              <Settings size={14} strokeWidth={1.75} />
              <span className="formtab__title">{ts('title')}</span>
            </div>
            <div className="formtab__body">
              <SettingsPanel />
            </div>
          </div>
        ) : (
          <FilePreview target={active as PreviewTab} />
        )}
      </div>
    </section>
  );
}
