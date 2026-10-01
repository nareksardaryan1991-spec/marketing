import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { unregisterPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type { Business, Profile } from '@/lib/types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  business: Business | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Сбой сети, а не ответ сервера: Safari пишет «Load failed», Chrome — «Failed to fetch»,
// Firefox — «NetworkError…», React Native — «Network request failed».
export function isNetworkError(message: string | null | undefined) {
  return !!message && /load failed|failed to fetch|networkerror|network request failed/i.test(message);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchUserData(userId: string) {
  return Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single<Profile>(),
    supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at')
      .limit(1)
      .maybeSingle<Business>(),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadUserData = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setLoadError(null);
      setProfile(null);
      setBusiness(null);
      return;
    }
    setLoadError(null);
    let [profileRes, businessRes] = await fetchUserData(userId);
    // На телефоне первый запрос часто обрывается (приложение только проснулось, сеть
    // переключается) — повторяем пару раз, прежде чем показывать ошибку.
    for (const delay of [1000, 3000]) {
      if (!isNetworkError(profileRes.error?.message ?? businessRes.error?.message)) break;
      await wait(delay);
      [profileRes, businessRes] = await fetchUserData(userId);
    }
    // Вход сохранён, а профиля больше нет (пользователя удалили или демо-данные сброшены) —
    // выходим, чтобы человек увидел экран входа, а не ошибку.
    if (profileRes.error?.code === 'PGRST116') {
      await supabase.auth.signOut();
      setLoadError(null);
      setProfile(null);
      setBusiness(null);
      return;
    }
    setLoadError(profileRes.error?.message ?? businessRes.error?.message ?? null);
    setProfile(profileRes.data ?? null);
    setBusiness(businessRes.data ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadUserData(data.session?.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Запросы к Supabase внутри колбэка могут зависнуть — выносим из него.
        setTimeout(() => {
          loadUserData(next?.user.id);
        }, 0);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [loadUserData]);

  const refresh = useCallback(() => loadUserData(session?.user.id), [loadUserData, session]);

  // В браузере: сеть вернулась — пробуем загрузить снова, не дожидаясь нажатия.
  useEffect(() => {
    if (!isNetworkError(loadError) || typeof window === 'undefined' || !window.addEventListener) return;
    const retry = () => refresh();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [loadError, refresh]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, profile, business, loading, loadError, refresh, signOut }),
    [session, profile, business, loading, loadError, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
