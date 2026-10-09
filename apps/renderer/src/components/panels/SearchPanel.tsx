import { useTranslation } from 'react-i18next';
import { FileSpreadsheet, FileText } from 'lucide-react';

const GROUPS = [
  {
    file: '序时账.xlsx',
    icon: FileSpreadsheet,
    hits: [
      { line: '1182', pre: '与', hit: '鑫源商贸', post: '往来款，借方 ¥12,480,000' },
      { line: '2043', pre: '摘要：', hit: '鑫源商贸', post: '无合同' },
    ],
  },
  {
    file: '关联方清单.csv',
    icon: FileText,
    hits: [{ line: '7', pre: '', hit: '鑫源商贸', post: '— 实际控制人关联' }],
  },
];

export function SearchPanel() {
  const { t } = useTranslation('search');
  return (
    <>
      <input className="searchbox" placeholder={t('placeholder')} defaultValue="鑫源商贸" />
      <div className="field">
        <span className="field__label">{t('include')}</span>
        <input className="searchbox" defaultValue="*.xlsx, 底稿/**" />
      </div>
      <div className="field">
        <span className="field__label">{t('exclude')}</span>
        <input className="searchbox" defaultValue=".fireeye/**, dist/**" />
      </div>
      <div className="sidebar__subtitle">{t('resultSummary', { files: 2, matches: 3 })}</div>
      {GROUPS.map((group) => {
        const Icon = group.icon;
        return (
          <div key={group.file} className="tree">
            <div className="tree__row tree__row--folder">
              <Icon size={14} strokeWidth={1.75} />
              <span>{group.file}</span>
            </div>
            {group.hits.map((hit) => (
              <div key={hit.line} className="tree__row" style={{ paddingLeft: 22 }}>
                <span className="mono" style={{ color: 'var(--text-3)', width: 30, textAlign: 'right' }}>
                  {hit.line}
                </span>
                <span>{hit.pre}</span>
                <span className="hl">{hit.hit}</span>
                <span>{hit.post}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
