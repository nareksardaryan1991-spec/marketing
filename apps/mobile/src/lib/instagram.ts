import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { invokeFunction } from './functions';

// Открывает вход в Instagram. После него сервер вернёт пользователя на /social?instagram=<результат>.
export async function connectInstagram(businessId: string): Promise<string | null> {
  const returnUrl = Linking.createURL('/social');
  const { url } = await invokeFunction<{ url: string }>('instagram-connect', {
    business_id: businessId,
    return_url: returnUrl,
  });

  if (Platform.OS === 'web') {
    window.location.assign(url);
    return null;
  }
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  if (result.type !== 'success') return null;
  const outcome = Linking.parse(result.url).queryParams?.instagram;
  return typeof outcome === 'string' ? outcome : null;
}
