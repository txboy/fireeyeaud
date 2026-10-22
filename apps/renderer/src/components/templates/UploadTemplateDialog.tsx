import { useEffect, useState } from 'react';
import { Checkbox, Modal, Radio } from 'antd';
import { FilePlus2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConfigScope, TemplateKind } from '@fireeyeaud/shared';
import { useTemplatesStore } from '../../store/templates';
import { useWorkspaceStore } from '../../store/workspace';

export interface UploadTemplateDialogProps {
  open: boolean;
  kind: TemplateKind;
  defaultScope: ConfigScope;
  onCancel: () => void;
  onUploaded: () => void;
}

/** 上传 docx 模板：作用域 + 多选文件 + 是否设为默认。 */
export function UploadTemplateDialog({
  open,
  kind,
  defaultScope,
  onCancel,
  onUploaded,
}: UploadTemplateDialogProps) {
  const { t } = useTranslation('templates');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const upload = useTemplatesStore((s) => s.upload);
  const hasWorkspace = useWorkspaceStore((s) => Boolean(s.path));

  const [scope, setScope] = useState<ConfigScope>(defaultScope);
  const [paths, setPaths] = useState<string[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope === 'global' ? 'global' : 'project');
    setPaths([]);
    setIsDefault(false);
    setErrorKey(null);
    setBusy(false);
  }, [open, defaultScope]);

  const pickFiles = async () => {
    const api = window.fireeyeaud;
    if (!api?.openFiles) {
      setErrorKey('error.opFailed');
      return;
    }
    try {
      const selected = await api.openFiles('templates');
      if (selected.length) setPaths(selected);
    } catch {
      setErrorKey('error.opFailed');
    }
  };

  const submit = async () => {
    if (!paths.length) {
      setErrorKey('error.fileRequired');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await upload(kind, paths, scope, isDefault);
      onUploaded();
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('upload')}
      centered
      width={460}
      onCancel={() => {
        if (!busy) onCancel();
      }}
      footer={[
        <button
          key="cancel"
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={onCancel}
        >
          {tc('cancel')}
        </button>,
        <button
          key="ok"
          type="button"
          className="button"
          disabled={busy || !paths.length}
          onClick={() => void submit()}
        >
          {t('upload')}
        </button>,
      ]}
    >
      <div className="tpl-upload">
        <div className="tpl-upload__field">
          <span className="tpl-upload__label">{t('scope')}</span>
          <Radio.Group
            value={scope}
            onChange={(event) => setScope(event.target.value as ConfigScope)}
          >
            <Radio value="global">{t('scopeGlobal')}</Radio>
            <Radio value="project" disabled={!hasWorkspace}>
              {t('scopeProject')}
            </Radio>
          </Radio.Group>
        </div>
        {!hasWorkspace && <div className="card__meta">{tc('noWorkspace')}</div>}

        <div className="tpl-upload__field">
          <span className="tpl-upload__label">{t('uploadMany')}</span>
          <button type="button" className="button button--sm button--ghost" onClick={() => void pickFiles()}>
            <Upload size={12} strokeWidth={1.9} /> {t('upload')}
          </button>
        </div>

        {paths.length > 0 && (
          <ul className="tpl-upload__files">
            {paths.map((path) => (
              <li key={path}>
                <FilePlus2 size={11} strokeWidth={1.8} />
                {path.split(/[\\/]/).pop()}
              </li>
            ))}
          </ul>
        )}

        <Checkbox
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        >
          {t('setAsDefault')}
        </Checkbox>
        {isDefault && paths.length > 1 && (
          <div className="card__meta">{t('defaultFirstHint')}</div>
        )}

        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </div>
    </Modal>
  );
}