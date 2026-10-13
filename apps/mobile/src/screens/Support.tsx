import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { get } from '../api';
import { Btn, C, Card, Chevron, ErrorText, Icon, Loading, Notice, SP, Screen, Section, s } from '../ui';

interface HelpVideo { title: string; language: string; url: string }
interface SupportInfo { supportPhone: string | null; supportEmail: string | null; supportHours: string | null; helpVideos: HelpVideo[] }

/** Call or email support, and help videos in the app's language that open in YouTube. */
export default function Support() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SupportInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await get<SupportInfo>('/support'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Videos in the app's language; English ones when there are none yet.
  const all = data?.helpVideos ?? [];
  const mine = all.filter((v) => v.language === i18n.language);
  const videos = mine.length ? mine : all.filter((v) => v.language === 'en');
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

  return (
    <Screen title={t('support.title')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {!data && !error ? (
          <Loading />
        ) : data ? (
          <>
            <Card>
              <Text style={[s.muted, { marginBottom: SP.md }]}>{data.supportPhone || data.supportEmail ? t('support.intro') : t('support.notSet')}</Text>
              {data.supportPhone && <Btn big title={`${t('support.call')} ${data.supportPhone}`} onPress={() => open(`tel:${data.supportPhone!.replace(/[^\d+]/g, '')}`)} />}
              {data.supportEmail && <Btn kind="tonal" title={`${t('support.email')} ${data.supportEmail}`} onPress={() => open(`mailto:${data.supportEmail}`)} />}
              {data.supportHours && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
                  <Icon name="time-outline" size={18} color={C.muted} />
                  <Text style={[s.muted, { flexShrink: 1 }]}>
                    {t('support.hours')}: {data.supportHours}
                  </Text>
                </View>
              )}
            </Card>
            <Section title={t('support.videos')} />
            {!videos.length && <Notice tone="info" text={t('support.noVideos')} />}
            {videos.map((v) => (
              <Card key={v.url + v.title} onPress={() => open(v.url)} accessibilityLabel={`${v.title}, ${t('support.watch')}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
                  <Icon name="logo-youtube" size={28} color="#d92d20" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{v.title}</Text>
                    <Text style={s.muted}>{t('support.watch')}</Text>
                  </View>
                  <Chevron />
                </View>
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
