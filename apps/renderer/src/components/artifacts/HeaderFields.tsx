import { useTranslation } from 'react-i18next';

export interface HeaderValues {
  projectName: string;
  projectCode: string;
  auditee: string;
  period: string;
  preparedBy: string;
  reviewedBy: string;
  date: string;
}

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 生成取证单 / 报告的抬头字段（两个弹窗共用）。 */
export function HeaderFields({
  value,
  onChange,
  ns,
}: {
  value: HeaderValues;
  onChange: (next: HeaderValues) => void;
  ns: 'evidence-form' | 'report';
}) {
  const { t } = useTranslation(ns);
  const set = (key: keyof HeaderValues) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value });

  const fields: Array<[keyof HeaderValues, string, string?]> = [
    ['projectName', 'projectName'],
    ['projectCode', 'projectCode'],
    ['auditee', 'auditee'],
    ['period', 'period'],
    ['preparedBy', 'preparedBy'],
    ['reviewedBy', 'reviewedBy'],
    ['date', 'date', 'date'],
  ];

  return (
    <div className="artifact-form-grid">
      {fields.map(([key, label, type]) => (
        <label key={key} className="field">
          <span className="field__label">{t(label)}</span>
          <input
            className="searchbox"
            type={type ?? 'text'}
            value={value[key]}
            onChange={set(key)}
          />
        </label>
      ))}
    </div>
  );
}

/** 抬头字段 → 后端 `header` 字典（键与模板渲染上下文对应）。 */
export function toHeaderPayload(
  value: HeaderValues,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    projectName: value.projectName.trim(),
    projectCode: value.projectCode.trim(),
    auditee: value.auditee.trim(),
    period: value.period.trim(),
    preparedBy: value.preparedBy.trim(),
    reviewedBy: value.reviewedBy.trim(),
    date: value.date,
    ...extra,
  };
}