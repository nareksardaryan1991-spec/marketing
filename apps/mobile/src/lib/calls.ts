import * as Crypto from 'expo-crypto';
import { Linking } from 'react-native';

// Звонки идут через Jitsi: у каждого звонка своя комната со случайным именем.
// Сервер звонков можно сменить (например, на 8x8 JaaS или свой) переменной EXPO_PUBLIC_JITSI_URL;
// тот же адрес — в секрете JITSI_URL у notify-dispatch (ссылка в уведомлениях).
const JITSI_URL = (process.env.EXPO_PUBLIC_JITSI_URL || 'https://meet.jit.si').replace(/\/+$/, '');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// 20 случайных символов — угадать комнату и подслушать нельзя. Формат проверяет база.
export function newCallRoom() {
  const bytes = Crypto.getRandomBytes(20);
  return `marketing-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

export function callUrl(room: string, video: boolean, name: string) {
  const options = [
    `config.startWithVideoMuted=${!video}`,
    `config.prejoinConfig.enabled=false`,
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`,
  ];
  return `${JITSI_URL}/${room}#${options.join('&')}`;
}

// В браузере звонок открывается в новой вкладке, на телефоне — в приложении Jitsi или браузере.
export function openCall(room: string, video: boolean, name: string) {
  return Linking.openURL(callUrl(room, video, name));
}
