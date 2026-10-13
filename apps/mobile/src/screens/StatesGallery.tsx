import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { ApiError } from '../api';
import { EmptyState, ErrorState, FormProblems, LoadingState, NoInternet, NoSearchResults, PermissionDenied, SessionEndedNotice, SkeletonList, SuccessState } from '../states';
import { Btn, Field, Screen, Section, SP, money, s } from '../ui';

/**
 * Preview of the standard screen states with sample text. Reached only in development builds (see Home and
 * App.tsx); it is not in the side menu or the tabs.
 */
export default function StatesGallery() {
  const { t } = useTranslation();
  const noop = () => undefined;
  const item = (key: string, node: ReactNode) => (
    <View key={key} testID={`state-${key}`} style={{ marginBottom: SP.xl }}>
      <Section title={t(`states.gallery.names.${key}`)} />
      {node}
    </View>
  );
  return (
    <Screen title={t('states.gallery.title')} subtitle={t('states.gallery.subtitle')}>
      {item('empty', <EmptyState title={t('common.noData')} help={t('states.empty.help')} action={{ title: t('mobile.addCustomer'), onPress: noop }} />)}
      {item('loading', (
        <>
          <LoadingState />
          <SkeletonList rows={2} />
        </>
      ))}
      {item('error', <ErrorState error={new ApiError(409, '', 'errors.dayClosed')} onRetry={noop} />)}
      {item('offline', <NoInternet pending={3} onRetry={noop} />)}
      {item('slow', <LoadingState slow onKeepWaiting={noop} onCancel={noop} />)}
      {item('noResults', <NoSearchResults query="Lakshmi" onClear={noop} />)}
      {item('denied', <PermissionDenied onBack={noop} />)}
      {item('session', <SessionEndedNotice unsent={2} />)}
      {item('form', (
        <>
          <FormProblems problems={[{ field: 'name', text: t('states.form.required', { field: t('common.name') }) }, { field: 'amount', text: t('mobile.enterAmount') }]} />
          <Field label={t('common.phone')} value="" onChangeText={noop} error={t('states.form.required', { field: t('common.phone') })} />
        </>
      ))}
      {item('success', (
        <View style={{ height: 440 }}>
          <SuccessState title={t('collection.saved')} text={<Text style={[s.big, { textAlign: 'center' }]}>{money(45000)}</Text>}>
            <Btn big title={t('mobile.nextCustomer')} onPress={noop} />
            <Btn kind="outline" title={t('states.actions.backToRoute')} onPress={noop} style={{ marginBottom: 0 }} />
          </SuccessState>
        </View>
      ))}
    </Screen>
  );
}
