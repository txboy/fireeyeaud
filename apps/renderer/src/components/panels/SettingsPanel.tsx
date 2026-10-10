import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio, Select, Switch } from 'antd';
import { supportedLocales } from '@fireeyeaud/shared/locales';
import { useSettingsStore } from '../../store/settings';
import { RulesPanel } from './RulesPanel';

type NavKey = 'appearance' | 'rules' | 'web' | 'data' | 'about';

function WebSearchSection() {
  const { t } = useTranslation('settings');
  const webSearch = useSettingsStore((s) => s.webSearch);
  const saveWebSearch = useSettingsStore((s) => s.saveWebSearch);
  const [enabled, setEnabled] = useState(webSearch.enabled);
  const [provider, setProvider] = useState(webSearch.provider || 'tavily');
  const [baseUrl, setBaseUrl] = useState(webSearch.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnabled(webSearch.enabled);
    setProvider(webSearch.provider || 'tavily');
    setBaseUrl(webSearch.baseUrl ?? '');
  }, [webSearch]);

  const submit = async () => {
    setBusy(true);
    const ok = await saveWebSearch({
      enabled,
      provider,
      baseUrl: baseUrl || null,
      apiKey: apiKey || undefined,
    });
    setBusy(false);
    setSaved(ok);
    if (ok) setApiKey('');
  };

  return (
    <>
      <div className="field">
        <span className="field__label">{t('webEnabled')}</span>
        <Switch checked={enabled} onChange={setEnabled} />
      </div>
      <div className="field">
        <span className="field__label">{t('webProvider')}</span>
        <Select
          value={provider}
          style={{ width: 180 }}
          onChange={setProvider}
          options={[
            { value: 'tavily', label: 'Tavily' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </div>
      <div className="field">
        <span className="field__label">{t('webKey')}</span>
        <input
          className="searchbox"
          type="password"
          value={apiKey}
          placeholder={webSearch.keyRef ? t('webKeySet') : ''}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      {provider === 'custom' && (
        <div className="field">
          <span className="field__label">{t('webBaseUrl')}</span>
          <input
            className="searchbox"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      )}
      <div className="field">
        <span className="field__label" />
        <button
          type="button"
          className="button button--sm"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t('save')}
        </button>
        {saved && <span className="card__meta">{t('saved')}</span>}
      </div>
      <div className="note">{t('webHint')}</div>
    </>
  );
}

export function SettingsPanel() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [nav, setNav] = useState<NavKey>('appearance');
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const navs: { key: NavKey; label: string }[] = [
    { key: 'appearance', label: t('navAppearance') },
    { key: 'rules', label: t('navRules') },
    { key: 'web', label: t('navWeb') },
    { key: 'data', label: t('navData') },
    { key: 'about', label: t('navAbout') },
  ];

  return (
    <div className="settings">
      <div className="settings-nav">
        {navs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`settings-nav__item${nav === item.key ? ' settings-nav__item--active' : ''}`}
            onClick={() => setNav(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {nav === 'appearance' ? (
          <>
            <div className="field">
              <span className="field__label">{t('theme')}</span>
              <Radio.Group value={theme} onChange={(e) => setTheme(e.target.value)}>
                <Radio.Button value="light">{t('themeLight')}</Radio.Button>
                <Radio.Button value="dark">{t('themeDark')}</Radio.Button>
              </Radio.Group>
            </div>
            <div className="field">
              <span className="field__label">{t('language')}</span>
              <Select
                value={locale}
                style={{ width: 180 }}
                onChange={setLocale}
                options={supportedLocales.map((l) => ({ value: l, label: l }))}
              />
            </div>
          </>
        ) : nav === 'rules' ? (
          <RulesPanel />
        ) : nav === 'web' ? (
          <WebSearchSection />
        ) : (
          <div className="panel-empty">
            <span>{tc('comingSoon')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
