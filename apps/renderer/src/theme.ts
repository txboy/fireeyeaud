import { theme as antdThemeApi, type ThemeConfig } from 'antd';
import type { ThemeMode } from '@fireeyeaud/shared';

export type TokenSet = Record<string, string>;

export const tokens: Record<ThemeMode, TokenSet> = {
  light: {
    'app-bg': '#F5F6F8',
    titlebar: '#F8F9FB',
    activitybar: '#EDEFF2',
    sidebar: '#F7F8FA',
    'editor-bg': '#FFFFFF',
    'panel-bg': '#FAFBFC',
    border: '#E3E6EA',
    'border-strong': '#D5D9DE',
    'text-1': '#1A1D21',
    'text-2': '#5A6069',
    'text-3': '#8A9099',
    accent: '#E8590C',
    'accent-weak': '#FDEDE4',
    'accent-contrast': '#FFFFFF',
    danger: '#D92D20',
    'danger-weak': '#FEECEB',
    warning: '#B7791F',
    'warning-weak': '#FBF3E2',
    success: '#12805C',
    'success-weak': '#E7F6EF',
    info: '#1570EF',
    'info-weak': '#E8F1FE',
    hover: '#EEF0F3',
  },
  dark: {
    'app-bg': '#1E1F22',
    titlebar: '#232427',
    activitybar: '#1A1B1E',
    sidebar: '#202124',
    'editor-bg': '#26272B',
    'panel-bg': '#202124',
    border: '#33353A',
    'border-strong': '#3E4046',
    'text-1': '#E8EAED',
    'text-2': '#A6ABB3',
    'text-3': '#71767E',
    accent: '#FF8A3D',
    'accent-weak': '#3A2A1E',
    'accent-contrast': '#1A1B1E',
    danger: '#FF6B6B',
    'danger-weak': '#3A2222',
    warning: '#F5B544',
    'warning-weak': '#3A2F1A',
    success: '#4CC38A',
    'success-weak': '#1E3329',
    info: '#60A5FA',
    'info-weak': '#1E2A3A',
    hover: '#2A2C30',
  },
};

export function antdTheme(mode: ThemeMode): ThemeConfig {
  const t = tokens[mode];
  return {
    algorithm: mode === 'dark' ? antdThemeApi.darkAlgorithm : antdThemeApi.defaultAlgorithm,
    token: {
      colorPrimary: t.accent,
      colorBgLayout: t['app-bg'],
      colorBgContainer: t['editor-bg'],
      colorBgElevated: t['panel-bg'],
      colorText: t['text-1'],
      colorTextSecondary: t['text-2'],
      colorTextTertiary: t['text-3'],
      colorBorder: t['border-strong'],
      colorBorderSecondary: t.border,
      colorError: t.danger,
      colorWarning: t.warning,
      colorSuccess: t.success,
      colorInfo: t.info,
      borderRadius: 6,
      fontFamily: "'Noto Sans SC', 'Segoe UI', system-ui, sans-serif",
    },
  };
}

/** 把设计令牌写入 CSS 变量（供布局样式引用）。 */
export function applyCssVars(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  for (const [key, value] of Object.entries(tokens[mode])) {
    root.style.setProperty(`--${key}`, value);
  }
}
