import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { AutoApproveSetting } from '@/components/admin/AutoApproveSetting';
import { PromoCodes } from '@/components/admin/PromoCodes';
import { Screen } from '@/components/Screen';
import { PlatformPrices } from '@/components/PlatformPrices';
import { ServiceEditor } from '@/components/ServiceEditor';
import { taskStyles as styles } from '@/components/task/styles';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Service } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Каталог услуг и цены (только менеджер; права проверяет база).
export default function ServicesScreen() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'admin';
  const [services, setServices] = useState<Service[]>([]);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);

  const load = useCallback(() => {
    supabase
      .from('services')
      .select('*')
      .order('sort_order')
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setServices((data as Service[] | null) ?? []);
      });
  }, []);

  useFocusEffect(load);

  const add = async () => {
    const id = newId.trim().toLowerCase();
    const price = Number(newPrice.replace(/\s/g, ''));
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(id) || !newName.trim() || !Number.isInteger(price) || price < 0) {
      setError(t('services.invalidNew'));
      return;
    }
    setError(null);
    setAdding(true);
    const { error } = await supabase.from('services').insert({
      id,
      name: { ru: newName.trim() },
      price_amd: price,
      sort_order: (services.at(-1)?.sort_order ?? 0) + 10,
    });
    setAdding(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewId('');
    setNewName('');
    setNewPrice('');
    setRevision((r) => r + 1);
    load();
  };

  return (
    <Screen>
      <Text style={styles.muted}>{t('services.hint')}</Text>
      <ErrorText>{error}</ErrorText>
      {services.length > 0 && <PlatformPrices services={services} />}
      {services.map((service) => (
        <ServiceEditor key={`${service.id}-${revision}`} service={service} onSaved={load} />
      ))}
      <Card>
        <Text style={styles.cardTitle}>{t('services.addTitle')}</Text>
        <Field
          label={t('services.newId')}
          hint="photo_session"
          autoCapitalize="none"
          value={newId}
          onChangeText={setNewId}
        />
        <Field label={`${t('services.name')} (ru)`} value={newName} onChangeText={setNewName} />
        <Field
          label={t('services.price')}
          keyboardType="number-pad"
          value={newPrice}
          onChangeText={setNewPrice}
        />
        <Button title={t('services.add')} onPress={add} loading={adding} />
      </Card>
      {isOwner && <AutoApproveSetting />}
      {isOwner && <PromoCodes />}
    </Screen>
  );
}
