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

interface SettingsState {
  theme: ThemeMode;
  locale: string;
  webSearch: WebSearchSettings;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
  loadSettings: () => Promise<void>;
  saveWebSearch: (input: WebSearchInput) => Promise<boolean>;
}

const initialTheme = (localStorage.getItem('fireeyeaud.theme') as ThemeMode | null) ?? 'light';
const initialLocale = localStorage.getItem('fireeyeaud.locale') ?? 'zh-CN';

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: initialTheme,
  locale: initialLocale,
  webSearch: { enabled: false, provider: 'tavily', keyRef: null, baseUrl: null },
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
      set({ theme: settings.theme, locale: settings.locale, webSearch: settings.webSearch });
    } catch {
      /* sidecar 未就绪时沿用本地快照 */
    }
  },
  saveWebSearch: async (input) => {
    try {
      let keyRef: string | undefined;
      if (input.apiKey && window.fireeyeaud?.putSecret) {
        const ref = await window.fireeyeaud.putSecret(input.apiKey);
        if (ref) keyRef = ref;
      }
      const settings = await patchSettings({
        webSearch: {
          enabled: input.enabled,
          provider: input.provider,
          baseUrl: input.baseUrl ?? null,
          ...(keyRef ? { keyRef } : {}),
        },
      });
      set({ webSearch: settings.webSearch });
      return true;
    } catch {
      return false;
    }
  },
}));
