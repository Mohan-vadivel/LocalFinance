import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGUAGES } from '@localfinance/shared';
import { BASE } from '../api';
import { setLanguage } from '../i18n';
import { takeSessionEnded, useSession } from '../session';
import { getQueue } from '../store';
import { SessionEndedNotice } from '../states';
import { Btn, C, Card, Chips, ErrorText, Field, SP, s, useLayout } from '../ui';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useSession();
  const { compact } = useLayout();
  // Read once: true when the server ended the last session, so say why this screen is showing.
  const [ended] = useState(() => takeSessionEnded());
  const [unsent, setUnsent] = useState(0);
  useEffect(() => {
    if (ended) void getQueue().then((q) => setUnsent(q.length));
  }, [ended]);
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
        {/* Centred at phone width on tablets; a little less padding on small phones. */}
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: compact ? SP.lg : SP.xl, width: '100%', maxWidth: 480, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: SP.xl }}>
            <Image source={require('../../assets/logo.png')} accessibilityLabel={t('common.appName')} resizeMode="contain" style={{ width: 240, height: 80, marginBottom: SP.sm }} />
            <Text style={{ color: C.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{t('common.appName')}</Text>
          </View>
          <View style={{ marginBottom: SP.lg }}>
            <Chips value={i18n.language} onChange={(v) => void setLanguage(v)} items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))} />
          </View>
          <Card style={{ padding: compact ? SP.lg : SP.xl }}>
            {ended && <SessionEndedNotice unsent={unsent} />}
            <ErrorText error={error} />
            {(error as { code?: string } | null)?.code === 'errors.network' && <Text style={[s.muted, { marginBottom: SP.md }]}>{`${t('mobile.serverAddress')}: ${BASE}`}</Text>}
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
                    <Text style={[s.muted, { textAlign: 'center', marginTop: SP.lg }]}>Powered by WITS Technologies · witsapps.com</Text>
          </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
