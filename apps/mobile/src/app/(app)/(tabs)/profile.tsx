import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatBackground } from '@/components/chat/ChatBackground';
import { WALLPAPERS } from '@/components/chat/chatTheme';
import { Choice } from '@/components/Choice';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NavList, NavRow } from '@/components/NavList';
import { ProfileHeader } from '@/components/ProfileHeader';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ACCENT_COLORS, pickProfilePhoto, removeProfilePhotos, type ProfilePhoto } from '@/lib/avatars';
import { CURRENCIES } from '@/lib/money';
import { isManagerRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Currency, Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Личный кабинет: у каждого клиента и сотрудника свой — имя, фото, обложка, цвет, «о себе».
export default function ProfileScreen() {
  const { t } = useI18n();
  const { profile, refresh, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  if (!profile) return null;

  const update = async (values: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(values).eq('id', profile.id);
    if (error) throw error;
    await refresh();
  };

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const changePhoto = (kind: ProfilePhoto) =>
    run(kind, async () => {
      const path = await pickProfilePhoto(profile.id, kind);
      if (!path) return;
      const column = kind === 'avatar' ? 'avatar_path' : 'cover_path';
      const old = profile[column];
      await update({ [column]: path });
      await removeProfilePhotos([old]);
    });

  const removePhoto = (kind: ProfilePhoto) =>
    run(kind, async () => {
      const column = kind === 'avatar' ? 'avatar_path' : 'cover_path';
      const old = profile[column];
      await update({ [column]: null });
      await removeProfilePhotos([old]);
    });

  // Фон чатов: готовый узор или своё фото (старое своё фото удаляется).
  const wallpaperPhoto = profile.chat_wallpaper?.startsWith('photo:') ? profile.chat_wallpaper.slice(6) : null;
  const setWallpaper = (value: string) =>
    run('wallpaper', async () => {
      await update({ chat_wallpaper: value });
      if (wallpaperPhoto) await removeProfilePhotos([wallpaperPhoto]);
    });
  const pickWallpaper = () =>
    run('wallpaper', async () => {
      const path = await pickProfilePhoto(profile.id, 'wallpaper');
      if (!path) return;
      await update({ chat_wallpaper: `photo:${path}` });
      if (wallpaperPhoto) await removeProfilePhotos([wallpaperPhoto]);
    });

  const saveInfo = () =>
    run('info', async () => {
      if (!fullName.trim()) throw new Error(t('profile.nameRequired'));
      await update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        bio: bio.trim() || null,
      });
      return t('profile.saved');
    });

  const changePassword = () =>
    run('password', async () => {
      if (password.length < 6) throw new Error(t('auth.passwordShort'));
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      return t('profile.passwordChanged');
    });

  return (
    <Screen>
      <ProfileHeader profile={profile} subtitle={t(`roles.${profile.role}`)} />
      <ErrorText>{error}</ErrorText>
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <ProfileMenu profile={profile} />

      <Card>
        <Text style={styles.cardTitle}>{t('profile.photos')}</Text>
        <View style={styles.row}>
          <Button
            title={profile.avatar_path ? t('profile.changeAvatar') : t('profile.addAvatar')}
            onPress={() => changePhoto('avatar')}
            loading={busy === 'avatar'}
          />
          {profile.avatar_path && (
            <Button
              title={t('profile.remove')}
              variant="ghost"
              onPress={() => removePhoto('avatar')}
            />
          )}
        </View>
        <View style={styles.row}>
          <Button
            title={profile.cover_path ? t('profile.changeCover') : t('profile.addCover')}
            onPress={() => changePhoto('cover')}
            loading={busy === 'cover'}
          />
          {profile.cover_path && (
            <Button
              title={t('profile.remove')}
              variant="ghost"
              onPress={() => removePhoto('cover')}
            />
          )}
        </View>

        <Text style={styles.label}>{t('profile.color')}</Text>
        <View style={styles.swatches}>
          {ACCENT_COLORS.map((color) => {
            const selected = (profile.accent_color ?? ACCENT_COLORS[0]) === color;
            return (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={color}
                accessibilityState={{ selected }}
                onPress={() => run('color', () => update({ accent_color: color }))}
                style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchSelected]}
              />
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('chats.wallpaper')}</Text>
        <View style={styles.wallpapers}>
          {WALLPAPERS.map((w) => {
            const value = `preset:${w.id}`;
            const selected = (profile.chat_wallpaper ?? 'preset:classic') === value;
            return (
              <Pressable
                key={w.id}
                accessibilityRole="button"
                accessibilityLabel={w.id}
                accessibilityState={{ selected }}
                onPress={() => setWallpaper(value)}
                style={[styles.wallpaper, selected && styles.wallpaperSelected]}>
                <ChatBackground value={value}>
                  <View style={[styles.miniBubble, styles.miniTheirs]} />
                  <View style={[styles.miniBubble, styles.miniMine]} />
                </ChatBackground>
              </Pressable>
            );
          })}
          {wallpaperPhoto && (
            <View style={[styles.wallpaper, styles.wallpaperSelected]}>
              <ChatBackground value={profile.chat_wallpaper}>
                <View style={[styles.miniBubble, styles.miniTheirs]} />
                <View style={[styles.miniBubble, styles.miniMine]} />
              </ChatBackground>
            </View>
          )}
        </View>
        <Button
          title={t('chats.wallpaperPhoto')}
          variant="ghost"
          onPress={pickWallpaper}
          loading={busy === 'wallpaper'}
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('profile.about')}</Text>
        <Field label={t('auth.fullName')} value={fullName} onChangeText={setFullName} />
        <Field
          label={t('profile.phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          hint="+374 …"
        />
        <Field
          label={t('profile.bio')}
          hint={t('profile.bioHint')}
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={500}
        />
        <Text style={styles.muted}>
          {t('auth.email')}: {profile.email}
        </Text>
        <Button title={t('common.save')} onPress={saveInfo} loading={busy === 'info'} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('profile.password')}</Text>
        <Field
          label={t('profile.newPassword')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Button
          title={t('profile.changePassword')}
          variant="ghost"
          onPress={changePassword}
          loading={busy === 'password'}
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('common.language')}</Text>
        <LanguageSwitcher />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>{t('money.currency')}</Text>
        <Choice
          value={profile.currency ?? 'AMD'}
          onChange={(currency: Currency) =>
            run('currency', async () => {
              await update({ currency });
            })
          }
          options={CURRENCIES.map(({ code, sign }) => ({ value: code, label: `${sign} ${t(`money.names.${code}`)}` }))}
        />
        <Text style={styles.muted}>{t('money.currencyHint')}</Text>
      </Card>
      <Button title={t('common.signOut')} variant="ghost" onPress={signOut} />
    </Screen>
  );
}

// Все редкие экраны — здесь, одним списком; набор зависит от роли.
function ProfileMenu({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  if (profile.role === 'client') {
    return (
      <NavList>
        <NavRow icon="storefront-outline" title={t('business.title')} href="/business" />
        <NavRow icon="receipt-outline" title={t('receipts.title')} href="/receipts" />
        <NavRow icon="bar-chart-outline" title={t('reports.title')} href="/reports" />
        <NavRow icon="logo-instagram" title={t('social.title')} href="/social" />
        <NavRow icon="calendar-outline" title={t('calendar.title')} href="/calendar" />
        <NavRow icon="notifications-outline" title={t('notify.title')} href="/notifications" />
      </NavList>
    );
  }
  const manager = isManagerRole(profile.role);
  return (
    <NavList>
      {manager && <NavRow icon="speedometer-outline" title={t('dashboard.title')} href="/dashboard" />}
      {manager && <NavRow icon="cube-outline" title={t('tabs.ordersAll')} href="/orders" />}
      {manager && <NavRow icon="people-outline" title={t('team.title')} href="/team" />}
      {manager && <NavRow icon="pricetags-outline" title={t('services.title')} href="/services" />}
      <NavRow icon="calendar-outline" title={t('calendar.title')} href="/calendar" />
      <NavRow icon="notifications-outline" title={t('notify.title')} href="/notifications" />
    </NavList>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  label: { fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 8 },
  muted: { fontSize: 15, color: colors.muted },
  notice: { fontSize: 15, color: '#059669' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: 'transparent' },
  swatchSelected: { borderColor: colors.text },
  wallpapers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wallpaper: {
    width: 64,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  wallpaperSelected: { borderColor: '#2F8CF0' },
  miniBubble: { height: 12, borderRadius: 6, marginHorizontal: 6, marginTop: 10 },
  miniTheirs: { width: 34, backgroundColor: '#FFFFFF' },
  miniMine: { width: 30, alignSelf: 'flex-end', backgroundColor: '#DCEEFF' },
});
