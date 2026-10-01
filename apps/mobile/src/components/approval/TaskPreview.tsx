import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useI18n } from '@/i18n';
import { previewKind } from '@/lib/approvals';
import { signedUrls } from '@/lib/files';
import type { Deliverable } from '@/lib/types';

import { colors } from '../theme';
import { Card } from '../ui';
import { PostPreview } from './PostPreview';

// Для команды: как клиент увидит последнюю версию на согласовании.
export function TaskPreview({ version, serviceId, name }: { version: Deliverable; serviceId: string; name: string }) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = version.files.join('|');

  useEffect(() => {
    if (!key) return;
    signedUrls(key.split('|'))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [key]);

  return (
    <Card>
      <Text style={styles.title}>{t('approvals.previewTitle', { version: version.version })}</Text>
      <PostPreview
        kind={previewKind(serviceId)}
        name={name}
        files={version.files}
        urls={urls}
        caption={version.caption}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
});
