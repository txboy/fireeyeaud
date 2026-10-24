import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Database,
  File as FileIcon,
  FileCheck2,
  MessageSquare,
  Play,
  Search,
  Settings,
  Table2,
  X,
} from 'lucide-react';
import {
  useUiStore,
  type DbDataTab,
  type DbSchemaTab,
  type EvidenceFormTab,
  type FormTab,
  type KbBrowseTab,
  type KbQueryTab,
  type PreviewTab,
  type ReportTab,
  type RightTab,
  type RuleRunTab,
  type SessionTab,
} from '../store/ui';
import { useChatStore } from '../store/chat';
import { confirmStopSession } from '../lib/stop-guard';
import { AgentColumn } from './AgentColumn';
import { ResultsColumn } from './ResultsColumn';
import { FilePreview } from './FilePreview';
import { FormTabView } from './FormTabView';
import { RuleRunView } from './RuleRunView';
import { DbSchemaView } from './DbSchemaView';
import { DbDataView } from './DbDataView';
import { KbBrowseView } from './KbBrowseView';
import { KbQueryView } from './KbQueryView';
import { SettingsPanel } from './panels/SettingsPanel';
import { ReportWorkspace } from './reports/ReportWorkspace';
import { WorkspaceShell } from './workspace/WorkspaceShell';
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
      : tab.kind === 'report' || tab.kind === 'evidenceForm'
        ? tab.name
        : tab.kind === 'form'
          ? formTitle(tab)
          : tab.kind === 'settings'
            ? ts('title')
            : tab.kind === 'dbData'
              ? `${tab.name} / ${tab.table.table}`
              : tab.kind === 'kbQuery' && tab.knowledgeName
                ? `${tab.name} / ${tab.knowledgeName}`
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
              : tab.kind === 'report' || tab.kind === 'evidenceForm'
                ? FileCheck2
                : tab.kind === 'form'
                  ? FORM_DOMAIN_ICON[tab.domain]
                  : tab.kind === 'settings'
                    ? Settings
                    : tab.kind === 'ruleRun'
                      ? Play
                      : tab.kind === 'dbSchema'
                        ? Database
                        : tab.kind === 'dbData'
                          ? Table2
                          : tab.kind === 'kbBrowse'
                            ? BookOpen
                            : tab.kind === 'kbQuery'
                              ? Search
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
        ) : active.kind === 'report' ? (
          <ReportWorkspace key={active.id} reportId={(active as ReportTab).reportId} />
        ) : active.kind === 'evidenceForm' ? (
          <WorkspaceShell
            key={active.id}
            kind="evidence-form"
            id={(active as EvidenceFormTab).formId}
          />
        ) : active.kind === 'form' ? (
          <FormTabView key={active.id} tab={active as FormTab} />
        ) : active.kind === 'ruleRun' ? (
          <RuleRunView key={active.id} tab={active as RuleRunTab} />
        ) : active.kind === 'dbSchema' ? (
          <DbSchemaView key={active.id} tab={active as DbSchemaTab} />
        ) : active.kind === 'dbData' ? (
          <DbDataView key={active.id} tab={active as DbDataTab} />
        ) : active.kind === 'kbBrowse' ? (
          <KbBrowseView key={active.id} tab={active as KbBrowseTab} />
        ) : active.kind === 'kbQuery' ? (
          <KbQueryView key={active.id} tab={active as KbQueryTab} />
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
