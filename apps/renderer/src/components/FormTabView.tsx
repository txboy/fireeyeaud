import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, type FormTab } from '../store/ui';
import { useModelsStore } from '../store/models';
import { useMcpStore } from '../store/mcp';
import { useSkillsStore } from '../store/skills';
import { useDatabaseStore } from '../store/database';
import { useKnowledgeStore } from '../store/knowledge';
import { ModelForm } from './forms/ModelForm';
import { McpForm } from './forms/McpForm';
import { SkillForm } from './forms/SkillForm';
import { DatabaseForm } from './forms/DatabaseForm';
import { KnowledgeForm } from './forms/KnowledgeForm';
import { FORM_DOMAIN_ICON, useFormTitle } from './forms/meta';

/** 「配置表单」tab 内容：按域路由到对应表单，编辑时从 store 取实体。 */
export function FormTabView({ tab }: { tab: FormTab }) {
  const { t } = useTranslation('error');
  const title = useFormTitle();
  const closeTab = useUiStore((s) => s.closeRightTab);
  const models = useModelsStore((s) => s.items);
  const mcp = useMcpStore((s) => s.items);
  const skills = useSkillsStore((s) => s.items);
  const databases = useDatabaseStore((s) => s.items);
  const kbProviders = useKnowledgeStore((s) => s.items);

  const onClose = useCallback(() => {
    void closeTab(tab.id);
  }, [closeTab, tab.id]);

  const editing = tab.mode === 'edit';

  let body = null;
  if (tab.domain === 'models') {
    const entity = editing ? models.find((i) => i.id === tab.entityId) : undefined;
    body =
      editing && !entity ? null : (
        <ModelForm entity={entity} onSaved={onClose} onCancel={onClose} />
      );
  } else if (tab.domain === 'mcp') {
    const entity = editing ? mcp.find((i) => i.id === tab.entityId) : undefined;
    body =
      editing && !entity ? null : (
        <McpForm entity={entity} onSaved={onClose} onCancel={onClose} />
      );
  } else if (tab.domain === 'skills') {
    const entity = editing ? skills.find((i) => i.id === tab.entityId) : undefined;
    body =
      editing && !entity ? null : (
        <SkillForm entity={entity} onSaved={onClose} onCancel={onClose} />
      );
  } else if (tab.domain === 'knowledge') {
    const entity = editing ? kbProviders.find((i) => i.id === tab.entityId) : undefined;
    body =
      editing && !entity ? null : (
        <KnowledgeForm entity={entity} onSaved={onClose} onCancel={onClose} />
      );
  } else {
    const entity = editing ? databases.find((i) => i.id === tab.entityId) : undefined;
    body =
      editing && !entity ? null : (
        <DatabaseForm entity={entity} onSaved={onClose} onCancel={onClose} />
      );
  }

  const Icon = FORM_DOMAIN_ICON[tab.domain];

  return (
    <div className="formtab">
      <div className="formtab__head">
        <Icon size={14} strokeWidth={1.75} />
        <span className="formtab__title">{title(tab)}</span>
      </div>
      <div className="formtab__body">
        {body ?? (
          <div className="panel-empty">
            <span>{t('notFound')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
