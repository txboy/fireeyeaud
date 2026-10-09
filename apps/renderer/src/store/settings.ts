import { create } from 'zustand';
import type { ThemeMode } from '@fireeyeaud/shared';
import i18n from '../i18n';
import { applyCssVars } from '../theme';

// 说明：语言 / 主题偏好最终应落到 `~/.fireeye/config/settings.json`（设计 §14.20）；
// 后端 settings API 就绪前，先以 localStorage 暂存。
interface SettingsState {
  theme: ThemeMode;
  locale: string;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: string) => void;
}

const initialTheme = (localStorage.getItem('fireeyeaud.theme') as ThemeMode | null) ?? 'light';
const initialLocale = localStorage.getItem('fireeyeaud.locale') ?? 'zh-CN';

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: initialTheme,
  locale: initialLocale,
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
}));
