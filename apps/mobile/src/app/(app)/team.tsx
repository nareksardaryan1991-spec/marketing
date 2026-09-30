import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ASSIGNABLE_ROLES } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Люди компании. Роли назначает только владелец (admin); остальные видят список.
export default function TeamScreen() {
  const { t } = useI18n();
  const { profile: me } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = me?.role === 'admin';

  const load = useCallback(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setPeople((data as Profile[] | null) ?? []);
      });
  }, []);

  useFocusEffect(load);

  const changeRole = async (userId: string, role: UserRole) => {
    setError(null);
    const { error } = await supabase.rpc('set_user_role', { target_user: userId, new_role: role });
    if (error) setError(error.message);
    setOpen(null);
    load();
  };

  const pending = people.filter((p) => p.role === 'pending');
  const staff = people.filter((p) => p.role !== 'pending' && p.role !== 'client');
  const clients = people.filter((p) => p.role === 'client');

  const personRow = (person: Profile) => {
    const editable = isAdmin && person.id !== me?.id && person.role !== 'admin';
    return (
      <View key={person.id} style={styles.row}>
        <Pressable
          disabled={!editable}
          accessibilityRole={editable ? 'button' : undefined}
          onPress={() => setOpen(open === person.id ? null : person.id)}
          style={styles.rowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{person.full_name || '—'}</Text>
            <Text style={styles.muted}>{person.email}</Text>
          </View>
          <Text style={[styles.role, person.role === 'pending' && styles.rolePending]}>
            {t(`roles.${person.role}`)}
            {editable ? ' ▾' : ''}
          </Text>
        </Pressable>
        {open === person.id && (
          <Choice
            value={person.role}
            onChange={(role) => changeRole(person.id, role)}
            options={ASSIGNABLE_ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
          />
        )}
      </View>
    );
  };

  return (
    <Screen>
      <Text style={styles.hint}>{isAdmin ? t('team.hintAdmin') : t('team.hintViewer')}</Text>
      <ErrorText>{error}</ErrorText>

      {pending.length > 0 && (
        <Card>
          <Text style={styles.cardTitle}>
            {t('team.pending')} ({pending.length})
          </Text>
          {pending.map(personRow)}
        </Card>
      )}

      <Card>
        <Text style={styles.cardTitle}>{t('team.staff')}</Text>
        {staff.map(personRow)}
      </Card>

      {clients.length > 0 && (
        <Card>
          <Text style={styles.cardTitle}>{t('team.clients')}</Text>
          {clients.map(personRow)}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: colors.muted },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  row: {
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '500', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  role: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  rolePending: { color: '#92400E' },
});
