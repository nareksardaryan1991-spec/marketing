import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { useI18n } from '@/i18n';

import {
  defaultValue,
  fieldStyles as styles,
  formatValue,
  LOCALES,
  type DateTimeFieldProps,
} from './dateTimeShared';
import { Button } from './ui';

// Выбор даты (и времени) системным пикером телефона.
export function DateTimeField({ label, value, onChange, mode }: DateTimeFieldProps) {
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value ?? defaultValue(mode));

  const openAndroid = () => {
    const start = value ?? defaultValue(mode);
    // На Android нет режима «дата и время»: сначала календарь, потом часы.
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) return;
        if (mode === 'date') {
          onChange(date);
          return;
        }
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: true,
          onChange: (timeEvent, time) => {
            if (timeEvent.type !== 'set' || !time) return;
            const combined = new Date(date);
            combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
            onChange(combined);
          },
        });
      },
    });
  };

  const press = () => {
    if (Platform.OS === 'android') openAndroid();
    else {
      setDraft(value ?? defaultValue(mode));
      setOpen(true);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={press} style={styles.box}>
          <Text style={value ? styles.value : styles.placeholder}>
            {value ? formatValue(value, mode, language) : t('dateField.choose')}
          </Text>
        </Pressable>
        {value && (
          <Pressable accessibilityRole="button" onPress={() => onChange(null)}>
            <Text style={styles.clear}>{t('dateField.clear')}</Text>
          </Pressable>
        )}
      </View>
      {open && Platform.OS === 'ios' && (
        <>
          <DateTimePicker
            value={draft}
            mode={mode}
            display="inline"
            locale={LOCALES[language]}
            onChange={(_, date) => date && setDraft(date)}
          />
          <Button
            title={t('dateField.done')}
            variant="ghost"
            onPress={() => {
              onChange(draft);
              setOpen(false);
            }}
          />
        </>
      )}
    </View>
  );
}
