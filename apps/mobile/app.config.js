// Основные настройки — в app.json. Здесь только адрес сайта в подпапке:
// GitHub Pages отдаёт проект по адресу https://<логин>.github.io/<репозиторий>/,
// поэтому при сборке для него задаётся WEB_BASE_URL=/<репозиторий>.
// Локальные сборки (preview.sh, local.sh) идут без него — от корня сайта.
module.exports = ({ config }) => {
  const baseUrl = process.env.WEB_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
