// Подпись Android-сборки своим ключом (для APK и для Google Play).
// Папка android/ генерируется заново (expo prebuild), поэтому правим её здесь, а не руками.
// Ключ берётся из переменных окружения при сборке:
//   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
// Без них release подписывается отладочным ключом, как в шаблоне Expo.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('ANDROID_KEYSTORE_PATH')) return cfg;

    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => m + RELEASE_CONFIG);
    // В блоке buildTypes { release { ... } } шаблон ставит отладочную подпись — меняем на свою.
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    );
    if (!gradle.includes('signingConfigs.release')) {
      throw new Error('with-release-signing: не нашёл, где задать подпись в android/app/build.gradle');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
