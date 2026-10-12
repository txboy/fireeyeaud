import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { setLeaveGuard } from '../../store/ui';

interface UnsavedGuard {
  /** 渲染在表单末尾的「未保存」确认弹窗。 */
  modal: ReactElement;
  /** 保存 / 取消后主动离开时调用（跳过守卫，避免二次确认）。 */
  forceLeave: () => void;
}

/**
 * 配置表单的未保存守卫：有修改时切换 / 关闭 tab / 回会话前弹「保存 / 不保存 / 取消」。
 * 与预览 tab 共用右侧区的离开守卫（同一时刻只有一个内容挂载）。
 */
export function useUnsavedGuard(
  dirty: boolean,
  save: () => Promise<boolean>,
  name?: string,
): UnsavedGuard {
  const { t } = useTranslation('preview');
  const { t: tc } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const resolver = useRef<((leave: boolean) => void) | null>(null);
  const allowed = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    setLeaveGuard(() => {
      if (!dirtyRef.current || allowed.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      });
    });
    return () => setLeaveGuard(null);
  }, []);

  const finish = (leave: boolean) => {
    setOpen(false);
    resolver.current?.(leave);
    resolver.current = null;
  };

  const forceLeave = () => {
    allowed.current = true;
    dirtyRef.current = false;
  };

  const modal = (
    <Modal
      open={open}
      title={t('unsavedTitle')}
      closable={false}
      maskClosable={false}
      onCancel={() => finish(false)}
      footer={[
        <button
          key="cancel"
          type="button"
          className="button button--ghost"
          onClick={() => finish(false)}
        >
          {tc('cancel')}
        </button>,
        <button
          key="discard"
          type="button"
          className="button button--ghost"
          onClick={() => finish(true)}
        >
          {t('discard')}
        </button>,
        <button
          key="save"
          type="button"
          className="button"
          onClick={() => {
            void saveRef.current().then((ok) => finish(ok));
          }}
        >
          {t('saveAndSwitch')}
        </button>,
      ]}
    >
      <p>{t('unsavedBody', { name: name ?? '' })}</p>
    </Modal>
  );

  return { modal, forceLeave };
}
