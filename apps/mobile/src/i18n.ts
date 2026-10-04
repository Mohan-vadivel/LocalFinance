import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { FALLBACK_LANGUAGE, resources } from '@localfinance/shared';

// Same language files as the web app and the API (packages/shared/src/i18n/*.json).
void i18n.use(initReactI18next).init({
  resources,
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function loadLanguage() {
  const saved = await AsyncStorage.getItem('lf.lang');
  if (saved) await i18n.changeLanguage(saved);
}

export async function setLanguage(code: string) {
  await AsyncStorage.setItem('lf.lang', code);
  await i18n.changeLanguage(code);
}

export default i18n;
