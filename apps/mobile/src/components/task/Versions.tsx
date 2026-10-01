import { Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import type { Deliverable } from '@/lib/types';

import { colors } from '../theme';
import { Card } from '../ui';
import { FileList } from './FileList';
import { taskStyles as styles } from './styles';

export function Versions({ versions }: { versions: Deliverable[] }) {
  const { t, language } = useI18n();
  if (versions.length === 0) return null;

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('task.versions')}</Text>
      {versions.map((v) => (
        <View
          key={v.id}
          style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={styles.label}>
            {t('task.version', { n: v.version })} · {formatDate(v.created_at, language)}
            {v.agent ? ` · 🤖 ${t(`agents.names.${v.agent}`)}` : ''}
          </Text>
          {v.caption ? (
            <Text selectable style={styles.text}>
              {v.caption}
            </Text>
          ) : null}
          <FileList paths={v.files} />
          {v.note ? <Text style={styles.muted}>{v.note}</Text> : null}
        </View>
      ))}
    </Card>
  );
}
