import { useEffect, useState } from 'react';
import { Modal, Radio } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ConfigScope } from '@fireeyeaud/shared';
import { useAttachDbStore } from '../store/attachDb';

/**
 * 全局「附加数据库」弹窗宿主（弹出层）。挂载一次于应用根部，
 * 由 `useAttachDbStore` 的命令式 `promptAttach()` 驱动。
 */
export function AttachDbDialog() {
  const { t } = useTranslation('enums');
  const open = useAttachDbStore((s) => s.open);
  const options = useAttachDbStore((s) => s.options);
  const respond = useAttachDbStore((s) => s.respond);
  const [scope, setScope] = useState<ConfigScope>('project');

  useEffect(() => {
    if (open) setScope(options?.defaultScope ?? 'project');
  }, [open, options]);

  return (
    <Modal
      open={open}
      title={options?.title}
      centered
      closable={false}
      maskClosable={false}
      width={400}
      onCancel={() => respond(null)}
      footer={[
        <button
          key="cancel"
          type="button"
          className="button button--ghost"
          onClick={() => respond(null)}
        >
          {options?.cancelLabel}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          onClick={() => respond({ scope })}
        >
          {options?.confirmLabel}
        </button>,
      ]}
    >
      <p>{options?.message}</p>
      <div className="field">
        <span className="field__label">{options?.scopeLabel}</span>
        <Radio.Group
          value={scope}
          onChange={(event) => setScope(event.target.value as ConfigScope)}
        >
          <Radio value="global">{t('configScope.global')}</Radio>
          <Radio value="project">{t('configScope.project')}</Radio>
        </Radio.Group>
      </div>
    </Modal>
  );
}
