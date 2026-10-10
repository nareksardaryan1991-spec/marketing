import { Pressable, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { dayKey, fromLocalInput, toLocalInput } from '@/lib/datetime';

import { fieldStyles as styles, type DateTimeFieldProps } from './dateTimeShared';
import { colors } from './theme';

// В браузере — стандартное поле даты/времени.
export function DateTimeField({ label, value, onChange, mode }: DateTimeFieldProps) {
  const { t } = useI18n();
  const inputValue = value
    ? mode === 'date'
      ? dayKey(value)
      : toLocalInput(value.toISOString()).replace(' ', 'T')
    : '';

  const change = (raw: string) => {
    if (!raw) {
      onChange(null);
      return;
    }
    const iso = fromLocalInput(raw);
    if (iso) onChange(new Date(iso));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <input
          type={mode === 'date' ? 'date' : 'datetime-local'}
          value={inputValue}
          onChange={(e) => change(e.target.value)}
          style={{
            flex: 1,
            minHeight: 48,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            padding: '0 14px',
            // Значок календаря и окно выбора даты браузер рисует в тёмных цветах.
            colorScheme: 'dark',
            fontSize: 16,
            color: colors.text,
            backgroundColor: colors.surface,
            fontFamily: 'inherit',
          }}
        />
        {value && (
          <Pressable accessibilityRole="button" onPress={() => onChange(null)}>
            <Text style={styles.clear}>{t('dateField.clear')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
