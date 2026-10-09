import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { ConfigScope } from '@fireeyeaud/shared';
import { ScopeBadge } from '../ScopeBadge';

interface Provider {
  name: string;
  type: string;
  scope: ConfigScope;
  baseUrl: string;
  remote: { name: string; docs: number; enabled: boolean }[];
}

const PROVIDERS: Provider[] = [
  {
    name: '事务所法规库',
    type: 'Dify',
    scope: 'project',
    baseUrl: 'https://api.dify.ai/v1',
    remote: [
      { name: '审计准则', docs: 128, enabled: true },
      { name: '企业会计准则汇编', docs: 76, enabled: true },
      { name: '税法与解释', docs: 45, enabled: false },
    ],
  },
  {
    name: '内部规章库',
    type: 'RAGFlow',
    scope: 'global',
    baseUrl: 'http://10.0.0.8:9380',
    remote: [
      { name: '内部质量控制制度', docs: 32, enabled: true },
      { name: '底稿编制指引', docs: 18, enabled: false },
    ],
  },
];

export function KnowledgePanel() {
  const { t } = useTranslation('knowledge');
  const { t: te } = useTranslation('enums');

  return (
    <>
      {PROVIDERS.map((provider) => (
        <div key={provider.name} className="card">
          <div className="card__row">
            <span
              style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--success)' }}
            />
            <span className="card__name">{provider.name}</span>
            <span className="scope-badge" style={{ color: 'var(--info)', background: 'var(--info-weak)' }}>
              {te(`kbProvider.${provider.type.toLowerCase()}`)}
            </span>
            <ScopeBadge scope={provider.scope} />
            <span className="spacer" />
          </div>
          <span className="card__meta">{provider.baseUrl}</span>
          {provider.remote.map((kb) => (
            <div key={kb.name} className="card__row">
              <span className={`checkbox${kb.enabled ? ' checkbox--on' : ''}`} />
              <span style={{ fontSize: 12 }}>{kb.name}</span>
              <span className="spacer" />
              <span className="card__meta">{t('documents', { count: kb.docs })}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="note">
        <Info size={14} strokeWidth={1.75} />
        <span>{t('egress')}</span>
      </div>
    </>
  );
}
