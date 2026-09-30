import { Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';

import { Card } from '../ui';
import { taskStyles as styles } from './styles';

export type Approval = {
  id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  created_at: string;
};

export function ClientFeedback({ approvals }: { approvals: Approval[] }) {
  const { t, language } = useI18n();
  if (approvals.length === 0) return null;

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('review.clientFeedback')}</Text>
      {approvals.map((a) => (
        <View key={a.id}>
          <Text style={styles.label}>
            {a.decision === 'approved' ? t('review.approved') : t('review.changesRequested')} ·{' '}
            {formatDate(a.created_at, language)}
          </Text>
          {a.comment ? <Text style={styles.text}>{a.comment}</Text> : null}
        </View>
      ))}
    </Card>
  );
}
