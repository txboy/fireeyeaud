import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import App from './App';
import './i18n';
import './styles/global.css';
import { useSettingsStore } from './store/settings';
import { antdTheme, applyCssVars } from './theme';

function Root() {
  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);

  useEffect(() => {
    applyCssVars(theme);
  }, [theme]);

  return (
    <ConfigProvider theme={antdTheme(theme)} locale={locale === 'en-US' ? enUS : zhCN}>
      <App />
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
