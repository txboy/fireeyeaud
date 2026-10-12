import { create } from 'zustand';
import type { ThemeMode, WebSearchSettings } from '@fireeyeaud/shared';
import i18n from '../i18n';
import { applyCssVars } from '../theme';
import { getSettings, patchSettings } from '../lib/api';

// 说明：语言 / 主题偏好以 localStorage 作为首屏快照，后端 `GET/PATCH /settings`
// 为权威来源（设计 §14.20）；联网检索配置亦经该端点持久化。
interface WebSearchInput {
  enabled: boolean;
  provider: string;
  baseUrl?: string | null;
  apiKey?: string;
}

interface GeneralInput {
  webSearch: WebSearchInput;
  systemPrompt: string;
}

interface SettingsState {
  theme: ThemeMode;
  locale: string;
  webSearch: WebSearchSettings;
  systemPrompt: string;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  loadSettings: () => Promise<void>;
  saveGeneral: (input: GeneralInput) => Promise<boolean>;
}

const initialTheme = (localStorage.getItem('fireeyeaud.theme') as ThemeMode | null) ?? 'light';
const initialLocale = localStorage.getItem('fireeyeaud.locale') ?? 'zh-CN';

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: initialTheme,
  locale: initialLocale,
  webSearch: { enabled: false, provider: 'tavily', keyRef: null, baseUrl: null },
  systemPrompt: '',
  setTheme: (theme) => {
    localStorage.setItem('fireeyeaud.theme', theme);
    applyCssVars(theme);
    set({ theme });
  },
  setLocale: (locale) => {
    localStorage.setItem('fireeyeaud.locale', locale);
    void i18n.changeLanguage(locale);
    set({ locale });
  },
  loadSettings: async () => {
    try {
      const settings = await getSettings();
      localStorage.setItem('fireeyeaud.theme', settings.theme);
      localStorage.setItem('fireeyeaud.locale', settings.locale);
      applyCssVars(settings.theme);
      if (i18n.language !== settings.locale) void i18n.changeLanguage(settings.locale);
      set({
        theme: settings.theme,
        locale: settings.locale,
        webSearch: settings.webSearch,
        systemPrompt: settings.systemPrompt ?? '',
      });
    } catch {
      /* sidecar 未就绪时沿用本地快照 */
    }
  },
  saveGeneral: async (input) => {
    try {
      let keyRef: string | undefined;
      if (input.webSearch.apiKey && window.fireeyeaud?.putSecret) {
        const ref = await window.fireeyeaud.putSecret(input.webSearch.apiKey);
        if (ref) keyRef = ref;
      }
      const settings = await patchSettings({
        webSearch: {
          enabled: input.webSearch.enabled,
          provider: input.webSearch.provider,
          baseUrl: input.webSearch.baseUrl ?? null,
          ...(keyRef ? { keyRef } : {}),
        },
        systemPrompt: input.systemPrompt,
      });
      set({
        webSearch: settings.webSearch,
        systemPrompt: settings.systemPrompt ?? '',
      });
      return true;
    } catch {
      return false;
    }
  },
}));
