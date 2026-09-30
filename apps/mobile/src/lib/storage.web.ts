// В браузере localStorage есть «из коробки». На сервере (статический рендер) его нет.
export const storage: Storage | undefined =
  typeof window === 'undefined' ? undefined : window.localStorage;
