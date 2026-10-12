import { Modal } from 'antd';
import { useConfirmStore } from '../store/confirm';

/**
 * 全局确认弹窗宿主（弹出层）。挂载一次于应用根部，
 * 由 `useConfirmStore` 的命令式 `confirm()` 驱动。
 */
export function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const respond = useConfirmStore((s) => s.respond);

  return (
    <Modal
      open={open}
      title={options?.title}
      closable={false}
      maskClosable={false}
      onCancel={() => respond(false)}
      footer={[
        <button
          key="cancel"
          type="button"
          className="button button--ghost"
          onClick={() => respond(false)}
        >
          {options?.cancelLabel}
        </button>,
        <button
          key="ok"
          type="button"
          className={`button${options?.danger ? ' button--danger' : ''}`}
          onClick={() => respond(true)}
        >
          {options?.confirmLabel}
        </button>,
      ]}
    >
      <p>{options?.message}</p>
    </Modal>
  );
}
