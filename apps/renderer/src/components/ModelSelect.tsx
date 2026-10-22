import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useModelsStore } from '../store/models';

/** 通用模型下拉：未指定时自动选中默认模型。 */
export function ModelSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('agent');
  const models = useModelsStore((s) => s.items);
  const load = useModelsStore((s) => s.load);

  useEffect(() => {
    if (models.length === 0) void load();
  }, [load, models.length]);

  useEffect(() => {
    if (models.length === 0) return;
    if (value && models.some((model) => model.id === value)) return;
    const preferred = models.find((model) => model.isDefault) ?? models[0];
    onChange(preferred.id);
  }, [models, onChange, value]);

  if (models.length === 0) return null;

  const selected =
    models.find((model) => model.id === value) ??
    models.find((model) => model.isDefault) ??
    models[0];

  return (
    <label className={`ctx-model${className ? ` ${className}` : ''}`} title={t('model')}>
      <Cpu size={13} strokeWidth={1.75} />
      <select
        className="ctx-select"
        aria-label={t('model')}
        value={selected.id}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </label>
  );
}
