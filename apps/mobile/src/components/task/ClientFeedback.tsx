import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { PostPreview } from '@/components/approval/PostPreview';
import { useI18n } from '@/i18n';
import { formatSeconds, previewKind } from '@/lib/approvals';
import { signedUrls } from '@/lib/files';
import { formatDate } from '@/lib/format';
import type { ApprovalMark, Deliverable } from '@/lib/types';

import { Card } from '../ui';
import { taskStyles as styles } from './styles';

export type Approval = {
  id: string;
  deliverable_id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  auto: boolean;
  approval_marks: (ApprovalMark & { position: number })[];
  created_at: string;
};

// Ответы клиента. Точки правок показаны на той версии, к которой клиент их поставил.
export function ClientFeedback({
  approvals,
  versions,
  serviceId,
  name,
}: {
  approvals: Approval[];
  versions: Deliverable[];
  serviceId: string;
  name: string;
}) {
  const { t, language } = useI18n();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const marked = approvals.filter((a) => a.approval_marks.length > 0);
  const key = marked
    .flatMap((a) => versions.find((v) => v.id === a.deliverable_id)?.files ?? [])
    .join('|');

  useEffect(() => {
    if (!key) return;
    signedUrls(key.split('|'))
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [key]);

  if (approvals.length === 0) return null;

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('review.clientFeedback')}</Text>
      {approvals.map((a) => {
        const version = versions.find((v) => v.id === a.deliverable_id);
        const marks = a.approval_marks.map((m) => ({ ...m, n: m.position }));
        return (
          <View key={a.id} style={{ gap: 6 }}>
            <Text style={styles.label}>
              {a.decision === 'approved'
                ? a.auto
                  ? t('approvals.autoApproved')
                  : t('review.approved')
                : t('review.changesRequested')}{' '}
              · {formatDate(a.created_at, language)}
              {version ? ` · v${version.version}` : ''}
            </Text>
            {a.comment ? <Text style={styles.text}>{a.comment}</Text> : null}
            {marks.length > 0 && version && (
              <>
                <PostPreview
                  kind={previewKind(serviceId)}
                  name={name}
                  files={version.files}
                  urls={urls}
                  caption={version.caption}
                  marks={marks}
                />
                {marks.map((m) => (
                  <Text key={m.n} style={styles.text}>
                    📍 {m.n}
                    {m.at_seconds != null ? ` (${formatSeconds(m.at_seconds)})` : ''} — {m.note}
                  </Text>
                ))}
              </>
            )}
          </View>
        );
      })}
    </Card>
  );
}
