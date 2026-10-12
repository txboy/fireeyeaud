import { useEffect, useState } from 'react';
import { Input, Modal } from 'antd';
import { usePromptStore } from '../store/prompt';

/**
 * 全局输入弹窗宿主（弹出层，用于重命名 / 新建命名）。
 * 挂载一次于应用根部，由 `usePromptStore` 的命令式 `prompt()` 驱动。
 */
export function PromptDialog() {
  const open = usePromptStore((s) => s.open);
  const options = usePromptStore((s) => s.options);
  const respond = usePromptStore((s) => s.respond);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue(options?.defaultValue ?? '');
  }, [open, options]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    respond(trimmed);
  };

  return (
    <Modal
      open={open}
      title={options?.title}
      centered
      closable={false}
      maskClosable={false}
      width={360}
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
          onClick={submit}
          disabled={!value.trim()}
        >
          {options?.confirmLabel}
        </button>,
      ]}
    >
      {options?.label && <label className="prompt__label">{options.label}</label>}
      <Input
        autoFocus
        value={value}
        placeholder={options?.placeholder}
        onChange={(event) => setValue(event.target.value)}
        onPressEnter={submit}
      />
    </Modal>
  );
}
