import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { InitOptions } from 'i18next';
import { namespaces, defaultLocale, resources } from '@fireeyeaud/shared/locales';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('fireeyeaud.locale') : null;
const initialLocale = stored || defaultLocale;

void i18n.use(initReactI18next).init({
  resources: resources as unknown as InitOptions['resources'],
  lng: initialLocale,
  fallbackLng: defaultLocale,
  ns: namespaces,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
} as InitOptions);

export default i18n;
