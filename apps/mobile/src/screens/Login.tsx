import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGUAGES } from '@localfinance/shared';
import { setLanguage } from '../i18n';
import { useSession } from '../session';
import { Btn, C, Card, Chips, ErrorText, Field, SP, s } from '../ui';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: SP.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: SP.xl }}>
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg, boxShadow: '0px 6px 16px rgba(15, 118, 110, 0.3)' }}>
              <Text style={{ color: '#fff', fontSize: 36, fontWeight: '800' }}>₹</Text>
            </View>
            <Text style={{ color: C.ink, fontSize: 28, fontWeight: '800', textAlign: 'center' }}>{t('common.appName')}</Text>
          </View>
          <View style={{ marginBottom: SP.lg }}>
            <Chips segmented value={i18n.language} onChange={(v) => void setLanguage(v)} items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))} />
          </View>
          <Card style={{ padding: SP.xl }}>
            <ErrorText error={error} />
            {tenants ? (
              <View>
                <Text style={s.h2}>{t('auth.chooseTenant')}</Text>
                {tenants.map((tn) => (
                  <Btn key={tn.tenantId} kind="outline" title={tn.name} onPress={() => void submit(tn.tenantId)} busy={busy} />
                ))}
              </View>
            ) : (
              <View>
                <Text style={[s.h2, { fontSize: 22, marginBottom: SP.lg }]}>{t('auth.login')}</Text>
                <Field label={t('auth.loginId')} value={id} onChangeText={setId} autoComplete="username" autoCapitalize="none" />
                <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" onSubmitEditing={() => void submit()} />
                <Btn big title={t('auth.login')} onPress={() => void submit()} busy={busy} disabled={!id || pw.length < 6} style={{ marginTop: SP.xs, marginBottom: 0 }} />
              </View>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
