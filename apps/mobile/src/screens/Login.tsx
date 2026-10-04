import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGUAGES } from '@localfinance/shared';
import { setLanguage } from '../i18n';
import { useSession } from '../session';
import { Btn, C, Card, Chips, ErrorText, Field, s } from '../ui';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useSession();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tenants, setTenants] = useState<{ tenantId: string; name: string }[] | null>(null);

  const submit = async (tenantId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await login(id.trim(), pw, tenantId);
      if (r.chooseTenant) setTenants(r.chooseTenant);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.brandDark }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center', marginBottom: 20 }}>₹ {t('common.appName')}</Text>
          <Card>
            <Chips value={i18n.language} onChange={(v) => void setLanguage(v)} items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))} />
            <ErrorText error={error} />
            {tenants ? (
              <View>
                <Text style={s.h2}>{t('auth.chooseTenant')}</Text>
                {tenants.map((tn) => (
                  <Btn key={tn.tenantId} kind="plain" title={tn.name} onPress={() => void submit(tn.tenantId)} busy={busy} />
                ))}
              </View>
            ) : (
              <View>
                <Field label={t('auth.loginId')} value={id} onChangeText={setId} autoComplete="username" autoCapitalize="none" />
                <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" onSubmitEditing={() => void submit()} />
                <Btn title={t('auth.login')} onPress={() => void submit()} busy={busy} disabled={!id || pw.length < 6} />
              </View>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
