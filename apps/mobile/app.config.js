// Основные настройки — в app.json. Здесь то, что зависит от сборки:
// - адрес сайта в подпапке: GitHub Pages отдаёт проект по адресу https://<логин>.github.io/<репозиторий>/,
//   поэтому при сборке для него задаётся WEB_BASE_URL=/<репозиторий>. Локальные сборки
//   (preview.sh, local.sh) идут без него — от корня сайта;
// - номер Android-сборки (ANDROID_VERSION_CODE): Google Play требует, чтобы он рос с каждой загрузкой.
module.exports = ({ config }) => {
  const baseUrl = process.env.WEB_BASE_URL;
  const versionCode = Number(process.env.ANDROID_VERSION_CODE);
  return {
    ...config,
    ...(baseUrl && { experiments: { ...config.experiments, baseUrl } }),
    ...(versionCode && { android: { ...config.android, versionCode } }),
  };
};
