import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Progress, Radio, Select, Switch } from 'antd';
import { supportedLocales } from '@fireeyeaud/shared/locales';
import { useSettingsStore } from '../../store/settings';
import { useUiStore } from '../../store/ui';
import { useUpdatesStore } from '../../store/updates';
import { FormActions } from '../forms/FormActions';

/** 「设置」tab 内容：与配置表单一致的布局（单列表单 + 保存/取消）。 */
export function SettingsPanel() {
  const { t } = useTranslation('settings');
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const webSearch = useSettingsStore((s) => s.webSearch);
  const systemPromptStored = useSettingsStore((s) => s.systemPrompt);
  const saveGeneral = useSettingsStore((s) => s.saveGeneral);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const closeTab = useUiStore((s) => s.closeRightTab);
  const update = useUpdatesStore();
  const [feedDraft, setFeedDraft] = useState(update.feedUrl);
  const [feedError, setFeedError] = useState<'invalid_url' | 'busy' | null>(null);

  useEffect(() => {
    setFeedDraft(update.feedUrl);
  }, [update.feedUrl]);

  const applyFeed = async () => {
    const result = await update.setFeedUrl(feedDraft);
    setFeedError(
      result.ok ? null : result.error === 'busy' ? 'busy' : 'invalid_url',
    );
  };

  const statusText =
    update.error === 'dev_mode'
      ? t('updateDevMode')
      : update.error
        ? t('updateFailed')
        : update.phase === 'checking'
          ? t('updateChecking')
          : update.phase === 'available'
            ? t('updateAvailable', { version: update.availableVersion ?? '' })
            : update.phase === 'downloading'
              ? t('updateDownloading', { percent: update.percent })
              : update.phase === 'downloaded'
                ? t('updateDownloaded', { version: update.availableVersion ?? '' })
                : update.phase === 'not-available'
                  ? t('updateIdle')
                  : t('updateNotChecked');

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const [enabled, setEnabled] = useState(webSearch.enabled);
  const [provider, setProvider] = useState(webSearch.provider || 'tavily');
  const [baseUrl, setBaseUrl] = useState(webSearch.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(systemPromptStored);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnabled(webSearch.enabled);
    setProvider(webSearch.provider || 'tavily');
    setBaseUrl(webSearch.baseUrl ?? '');
  }, [webSearch]);

  useEffect(() => {
    setSystemPrompt(systemPromptStored);
  }, [systemPromptStored]);

  const submit = async () => {
    setBusy(true);
    const ok = await saveGeneral({
      webSearch: { enabled, provider, baseUrl: baseUrl || null, apiKey: apiKey || undefined },
      systemPrompt,
    });
    setBusy(false);
    setSaved(ok);
    if (ok) setApiKey('');
  };

  return (
    <div className="formtab__form">
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
      <label className="field field--inline">
        <Switch checked={enabled} onChange={setEnabled} />
        <span>{t('webEnabled')}</span>
      </label>
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
      <label className="field">
        <span className="field__label">{t('webKey')}</span>
        <input
          className="searchbox"
          type="password"
          value={apiKey}
          placeholder={webSearch.keyRef ? t('webKeySet') : ''}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      {provider === 'custom' && (
        <label className="field">
          <span className="field__label">{t('webBaseUrl')}</span>
          <input
            className="searchbox"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}
      <span className="card__meta">{t('webHint')}</span>
      <label className="field">
        <span className="field__label">{t('systemPrompt')}</span>
        <textarea
          className="searchbox"
          rows={6}
          value={systemPrompt}
          placeholder={t('systemPromptPlaceholder')}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </label>
      <span className="card__meta">{t('systemPromptHint')}</span>

      <div className="field">
        <span className="field__label">{t('updateSection')}</span>
        <label className="field field--inline">
          <Switch
            checked={update.enabled}
            onChange={(value) => void update.setEnabled(value)}
          />
          <span>{t('autoUpdateEnabled')}</span>
        </label>
        <span className="card__meta">{t('updateFeedHint')}</span>
      </div>
      <label className="field">
        <span className="field__label">{t('updateFeed')}</span>
        <input
          className="searchbox"
          value={feedDraft}
          onChange={(event) => setFeedDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void applyFeed();
          }}
        />
      </label>
      {feedError && (
        <span className="card__meta">
          {t(feedError === 'busy' ? 'updateFeedBusy' : 'updateFeedInvalid')}
        </span>
      )}
      <span className="card__meta">
        {t('updateCurrent', { version: update.currentVersion || '—' })}
      </span>
      <span className="card__meta">{statusText}</span>
      {update.phase === 'downloading' && (
        <Progress percent={update.percent} size="small" status="active" />
      )}
      <div className="field field--inline">
        <Button
          onClick={() => void applyFeed()}
          disabled={
            update.phase === 'checking' ||
            update.phase === 'downloading' ||
            update.phase === 'downloaded'
          }
        >
          {t('updateApplyFeed')}
        </Button>
        <Button
          onClick={() => void update.check()}
          loading={update.phase === 'checking'}
          disabled={update.phase === 'downloading'}
        >
          {t('updateCheck')}
        </Button>
        {update.phase === 'available' && (
          <Button type="primary" onClick={() => void update.download()}>
            {t('updateDownload')}
          </Button>
        )}
        {update.phase === 'downloaded' && (
          <Button type="primary" onClick={() => void update.install()}>
            {t('updateRestart')}
          </Button>
        )}
      </div>

      <FormActions
        onSave={() => void submit()}
        onCancel={() => void closeTab('settings')}
        busy={busy}
      />
      {saved && <span className="card__meta">{t('saved')}</span>}
    </div>
  );
}
