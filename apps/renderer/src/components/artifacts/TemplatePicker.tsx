import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, message } from 'antd';
import type { ConfigScope, TemplateKind } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';
import { useTemplatesStore } from '../../store/templates';
import { pickDefaultTemplate } from '../../lib/templates';

export interface TemplateChoice {
  id: string;
  scope: ConfigScope;
}

/**
 * 模板选择器（生成向导共用）：默认选中 `pickDefaultTemplate` 的结果，
 * 并允许把当前选择设为默认（写入模板配置，下次打开自动选中）。
 */
export function TemplatePicker({
  kind,
  value,
  onChange,
}: {
  kind: TemplateKind;
  value: TemplateChoice | null;
  onChange: (next: TemplateChoice | null) => void;
}) {
  const { t: tt } = useTranslation('templates');
  const { t } = useTranslation(kind === 'report' ? 'report' : 'evidence-form');
  const items = useTemplatesStore((s) => s.items);
  const load = useTemplatesStore((s) => s.load);
  const setDefault = useTemplatesStore((s) => s.setDefault);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(
    () => items.filter((item) => item.kind === kind),
    [items, kind],
  );

  // 首次加载 / 切换类型后自动选中默认模板（项目默认优先）。
  useEffect(() => {
    if (value || options.length === 0) return;
    const preferred = pickDefaultTemplate(items, kind);
    if (preferred) onChange({ id: preferred.id, scope: preferred.scope });
  }, [value, options.length, items, kind, onChange]);

  const selected = options.find(
    (item) => item.id === value?.id && item.scope === value?.scope,
  );
  const isDefault = Boolean(selected?.isDefault);

  if (options.length === 0) {
    return <div className="panel-error">{t('noTemplate')}</div>;
  }

  return (
    <div className="artifact-template">
      <label className="field">
        <span className="field__label">{t('template')}</span>
        <select
          className="searchbox"
          value={value ? `${value.scope}:${value.id}` : ''}
          onChange={(event) => {
            const [scope, id] = event.target.value.split(':');
            onChange(id ? { id, scope: scope as ConfigScope } : null);
          }}
        >
          {options.map((item) => (
            <option key={`${item.scope}:${item.id}`} value={`${item.scope}:${item.id}`}>
              {item.name}
              {item.builtin ? `（${tt('builtin')}）` : ''} ·{' '}
              {item.scope === 'global' ? tt('scopeGlobal') : tt('scopeProject')}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="artifact-template__meta">
          <span className="card__meta">{t('templateScope')}</span>
          <ScopeBadge scope={selected.scope} />
          {isDefault && <span className="tpl-badge">{tt('default')}</span>}
        </div>
      )}

      <Checkbox
        checked={isDefault}
        disabled={!selected || isDefault}
        onChange={(event) => {
          if (!event.target.checked || !selected) return;
          void (async () => {
            try {
              await setDefault(selected.id, selected.scope);
              void message.success(t('defaultSaved'));
            } catch (err) {
              // 勾选状态由 store 派生，失败后会自动回滚
              void message.error(
                ((err as { messageKey?: string }).messageKey ?? 'error.internal').replace(
                  /^error\./,
                  '',
                ),
              );
            }
          })();
        }}
      >
        {t('setAsDefault')}
      </Checkbox>
    </div>
  );
}