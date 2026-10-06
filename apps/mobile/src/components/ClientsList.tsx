import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Business } from '@/lib/types';

import { colors } from './theme';
import { Card, ErrorText } from './ui';

// Клиенты агентства (для команды): нажатие открывает профиль бизнеса.
export function ClientsList() {
  const { t } = useI18n();
  const [clients, setClients] = useState<Business[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setClients((data as Business[] | null) ?? []);
      });
  }, []);

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('home.clients')}</Text>
      <ErrorText>{error}</ErrorText>
      {clients.length === 0 && !error && <Text style={styles.muted}>{t('home.noClients')}</Text>}
      {clients.map((client) => (
        <Pressable
          key={client.id}
          style={styles.clientRow}
          onPress={() => router.push({ pathname: '/business', params: { id: client.id } })}>
          <Text style={styles.clientName}>{client.name}</Text>
          <Text style={styles.muted}>
            {[client.industry, client.city].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  clientRow: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clientName: { fontSize: 16, fontWeight: '500', color: colors.text },
});
