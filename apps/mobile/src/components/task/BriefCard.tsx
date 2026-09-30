import { Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import type { Business } from '@/lib/types';

import { Card } from '../ui';
import { taskStyles as styles } from './styles';

// Всё, что исполнителю нужно знать о клиенте и задаче.
export function BriefCard({
  business,
  orderNotes,
  brief,
  dueDate,
}: {
  business: Business | null;
  orderNotes: string | null;
  brief: string | null;
  dueDate: string | null;
}) {
  const { t, language } = useI18n();
  const rows: [string, string | null | undefined][] = [
    // due_date — день без времени: T12:00, чтобы часовой пояс не сдвинул дату.
    [t('task.dueDate'), dueDate && formatDate(`${dueDate}T12:00:00`, language)],
    [t('task.brief'), brief],
    [t('task.orderNotes'), orderNotes],
    [t('onboarding.industry').replace(' *', ''), business?.industry],
    [t('onboarding.city'), business?.city],
    [t('onboarding.description'), business?.description],
    [t('onboarding.targetAudience'), business?.target_audience],
    [t('onboarding.tone'), business?.tone],
    [t('onboarding.goals'), business?.goals],
    [t('onboarding.competitors'), business?.competitors],
    ['Instagram', business?.instagram_url],
    ['Facebook', business?.facebook_url],
    ['TikTok', business?.tiktok_url],
    [t('onboarding.website'), business?.website_url],
  ];

  return (
    <Card>
      <Text style={styles.cardTitle}>{business?.name ?? '—'}</Text>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <View key={label}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.text}>{value}</Text>
          </View>
        ))}
    </Card>
  );
}
