import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Громкий сигнал о новом сообщении в чате — рёв мотоцикла
// (assets/sounds/motorcycle.wav, генерируется scripts/make-motorcycle-sound.mjs).
// В браузере звук играет только после того, как человек хоть раз нажал что-то на странице.

// Один сигнал на пачку сообщений: и чат, и счётчик на главной могут заметить одно и то же.
const QUIET_MS = 3000;

let player: AudioPlayer | null = null;
let lastPlayed = 0;

export function playChatSound() {
  const now = Date.now();
  if (now - lastPlayed < QUIET_MS) return;
  lastPlayed = now;
  try {
    if (!player) {
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      player = createAudioPlayer(require('../../assets/sounds/motorcycle.wav'));
      player.volume = 1;
    }
    player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Звук — дополнение: если устройство не дало его сыграть, чат работает как обычно.
  }
}
