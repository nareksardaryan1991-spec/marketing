import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Language, Localized, Service } from '@/lib/types';

import { taskStyles as styles } from './task/styles';
import { colors } from './theme';
import { Button, Card, ErrorText, Field } from './ui';

const LANGS: Language[] = ['ru', 'hy', 'en'];

function clean(value: Record<Language, string>): Localized {
  return Object.fromEntries(
    LANGS.filter((l) => value[l].trim()).map((l) => [l, value[l].trim()]),
  ) as Localized;
}

function texts(value: Localized): Record<Language, string> {
  return { ru: value.ru ?? '', hy: value.hy ?? '', en: value.en ?? '' };
}

// Карточка услуги для менеджера: названия и описания на трёх языках, цена, видимость.
export function ServiceEditor({ service, onSaved }: { service: Service; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(texts(service.name));
  const [description, setDescription] = useState(texts(service.description));
  const [price, setPrice] = useState(String(service.price_amd));
  const [active, setActive] = useState(service.active);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const priceAmd = Number(price.replace(/\s/g, ''));
    if (!name.ru.trim() || !Number.isInteger(priceAmd) || priceAmd < 0) {
      setError(t('services.invalid'));
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('services')
      .update({
        name: clean(name),
        description: clean(description),
        price_amd: priceAmd,
        active,
      })
      .eq('id', service.id);
    setSaving(false);
    if (error) setError(error.message);
    else {
      setSaved(true);
      onSaved();
    }
  };

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setSaved(false);
  };

  return (
    <Card>
      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={styles.cardTitle}>{name.ru || service.id}</Text>
        <View style={[styles.row, { alignItems: 'center' }]}>
          <Text style={styles.muted}>{active ? t('services.visible') : t('services.hidden')}</Text>
          <Switch value={active} onValueChange={touch(setActive)} />
        </View>
      </View>
      <Text style={styles.muted}>id: {service.id}</Text>
      {service.per_platform ? (
        <Text style={styles.muted}>{t('services.pricePerPlatform')}</Text>
      ) : (
        <Field
          label={t('services.price')}
          keyboardType="number-pad"
          value={price}
          onChangeText={touch(setPrice)}
        />
      )}
      {LANGS.map((lang) => (
        <View key={lang} style={{ gap: 8 }}>
          <Field
            label={`${t('services.name')} (${lang})`}
            value={name[lang]}
            onChangeText={touch((v: string) => setName((prev) => ({ ...prev, [lang]: v })))}
          />
          <Field
            label={`${t('services.description')} (${lang})`}
            value={description[lang]}
            onChangeText={touch((v: string) => setDescription((prev) => ({ ...prev, [lang]: v })))}
          />
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      {saved && <Text style={{ color: colors.primary }}>{t('business.saved')}</Text>}
      <Button title={t('common.save')} onPress={save} loading={saving} />
    </Card>
  );
}
