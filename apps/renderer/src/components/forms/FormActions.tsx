import { useTranslation } from 'react-i18next';

interface FormActionsProps {
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** 新增模式主按钮显示「新增」，编辑模式显示「保存」。 */
  create?: boolean;
}

/** 表单底部「保存 / 取消」操作条。 */
export function FormActions({ onSave, onCancel, busy, disabled, create }: FormActionsProps) {
  const { t } = useTranslation('common');
  return (
    <div className="formtab__actions">
      <button
        type="button"
        className="button button--sm"
        disabled={busy || disabled}
        onClick={onSave}
      >
        {create ? t('add') : t('save')}
      </button>
      <button
        type="button"
        className="button button--sm button--ghost"
        onClick={onCancel}
      >
        {t('cancel')}
      </button>
    </div>
  );
}
