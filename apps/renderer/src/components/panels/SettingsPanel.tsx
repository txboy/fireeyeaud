import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio, Select } from 'antd';
import { supportedLocales } from '@fireeyeaud/shared/locales';
import { useSettingsStore } from '../../store/settings';

type NavKey = 'appearance' | 'rules' | 'web' | 'data' | 'about';

export function SettingsPanel() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [nav, setNav] = useState<NavKey>('appearance');
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

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
        ) : (
          <div className="panel-empty">
            <span>{tc('comingSoon')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
