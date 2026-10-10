import { GolosText_400Regular } from '@expo-google-fonts/golos-text/400Regular';
import { GolosText_500Medium } from '@expo-google-fonts/golos-text/500Medium';
import { GolosText_600SemiBold } from '@expo-google-fonts/golos-text/600SemiBold';
import { GolosText_700Bold } from '@expo-google-fonts/golos-text/700Bold';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { Onest_600SemiBold } from '@expo-google-fonts/onest/600SemiBold';
import { Onest_700Bold } from '@expo-google-fonts/onest/700Bold';
import { Onest_800ExtraBold } from '@expo-google-fonts/onest/800ExtraBold';
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Rubik_800ExtraBold } from '@expo-google-fonts/rubik/800ExtraBold';
import { Unbounded_600SemiBold } from '@expo-google-fonts/unbounded/600SemiBold';

import type { ThemeName } from './theme';

// Шрифты каждого оформления. Грузятся только шрифты выбранного (app/_layout.tsx).
// body — основной текст по толщине: на сайте он подставляется вместо системного шрифта (lib/webApp.web.ts).
export const THEME_FONTS: Record<ThemeName, { all: Record<string, number>; body: [number, number][] }> = {
  dark: {
    all: { GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold, Unbounded_600SemiBold },
    body: [
      [GolosText_400Regular, 400],
      [GolosText_500Medium, 500],
      [GolosText_600SemiBold, 600],
      [GolosText_700Bold, 700],
    ],
  },
  bright: {
    all: { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold },
    body: [
      [Manrope_500Medium, 400],
      [Manrope_600SemiBold, 500],
      [Manrope_700Bold, 600],
      [Manrope_800ExtraBold, 700],
    ],
  },
  bold: {
    all: { Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold, Rubik_800ExtraBold },
    body: [
      [Rubik_400Regular, 400],
      [Rubik_500Medium, 500],
      [Rubik_600SemiBold, 600],
      [Rubik_700Bold, 700],
    ],
  },
  story: {
    all: { Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, Onest_800ExtraBold },
    body: [
      [Onest_400Regular, 400],
      [Onest_500Medium, 500],
      [Onest_600SemiBold, 600],
      [Onest_700Bold, 700],
    ],
  },
};
