import { useTranslation } from 'react-i18next';
import { Paperclip, Send, Sparkles, Wrench } from 'lucide-react';

export function AgentColumn() {
  const { t } = useTranslation('agent');
  const { t: tc } = useTranslation('common');

  return (
    <main className="agent">
      <div className="agent__head">
        <Sparkles size={16} strokeWidth={1.75} color="var(--accent)" />
        <span className="sidebar__title">{t('name')}</span>
        <span className="spacer" />
        <span className="agent__chip">{tc('notConfigured')}</span>
      </div>

      <div className="agent__conv">
        <div className="panel-empty">
          <Sparkles size={26} strokeWidth={1.5} />
          <span>{t('empty')}</span>
        </div>
      </div>

      <div className="agent__input">
        <button type="button" className="activitybar__item" title={t('attach')}>
          <Paperclip size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="activitybar__item" title={t('selectTool')}>
          <Wrench size={16} strokeWidth={1.75} />
        </button>
        <input className="searchbox" placeholder={t('inputPlaceholder')} />
        <button type="button" className="button" title={t('send')} disabled>
          <Send size={15} strokeWidth={1.9} />
        </button>
      </div>
    </main>
  );
}
