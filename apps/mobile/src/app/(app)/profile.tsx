import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfileHeader } from '@/components/ProfileHeader';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ACCENT_COLORS, pickProfilePhoto, removeProfilePhotos, type ProfilePhoto } from '@/lib/avatars';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Личный кабинет: у каждого клиента и сотрудника свой — имя, фото, обложка, цвет, «о себе».
export default function ProfileScreen() {
  const { t } = useI18n();
  const { profile, refresh } = useAuth();
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
    </Screen>
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
});
