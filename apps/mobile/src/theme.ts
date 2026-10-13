import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { createElement, type ComponentProps } from 'react';
import { MD3LightTheme, type MD3Theme } from 'react-native-paper';
import { C } from './ui';

/**
 * The Paper theme: the MD3 light theme with the app's own colours, so the look stays on-brand. Primary is the brand
 * teal; surfaces stay white on the pale page; cards get no tint from elevation.
 */
export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 3,
  colors: {
    ...MD3LightTheme.colors,
    primary: C.brand,
    onPrimary: C.onBrand,
    primaryContainer: C.brandSoft,
    onPrimaryContainer: C.brandInk,
    secondary: C.brandDark,
    onSecondary: C.onBrand,
    secondaryContainer: C.brandSoft,
    onSecondaryContainer: C.brandInk,
    tertiary: C.brandDark,
    onTertiary: C.onBrand,
    tertiaryContainer: C.surface,
    onTertiaryContainer: C.ink2,
    background: C.bg,
    onBackground: C.ink,
    surface: C.panel,
    onSurface: C.ink,
    surfaceVariant: C.surface,
    onSurfaceVariant: C.muted,
    outline: C.lineStrong,
    outlineVariant: C.line,
    error: C.danger,
    onError: '#ffffff',
    errorContainer: C.dangerSoft,
    onErrorContainer: C.danger,
    elevation: {
      level0: 'transparent',
      level1: C.panel,
      level2: C.panel,
      level3: C.panel,
      level4: C.panel,
      level5: C.panel,
    },
  },
};

/** Paper's icon hook: icons are Material Community icons from the Expo vector-icons bundle. */
export function PaperIcon({ name, color, size }: { name: string; color?: string; size: number }) {
  return createElement(MaterialCommunityIcons, { name: name as ComponentProps<typeof MaterialCommunityIcons>['name'], color, size });
}
