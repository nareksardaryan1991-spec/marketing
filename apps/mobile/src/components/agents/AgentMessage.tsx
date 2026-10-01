import * as Clipboard from 'expo-clipboard';
import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { AGENTS, type AgentRun, type ChatResult } from '@/lib/agents';
import { signedUrls } from '@/lib/files';

import { colors } from '../theme';
import { ErrorText } from '../ui';
import { AttachToTask } from './AttachToTask';

// Одна пара «запрос сотрудника → ответ агента» в чате.
export function AgentMessage({ run, onChanged }: { run: AgentRun; onChanged: () => void }) {
  const { t } = useI18n();
  const meta = AGENTS.find((a) => a.id === run.agent);
  const result = run.status === 'done' ? (run.result as ChatResult | null) : null;
  const [attaching, setAttaching] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = [result?.text, result?.caption].filter(Boolean).join('\n\n');
    await Clipboard.setStringAsync(text);
    setCopied(true);
  };

  return (
    <View style={styles.pair}>
      <View style={styles.mine}>
        <Text selectable style={styles.mineText}>
          {run.instructions}
        </Text>
      </View>
      <View style={styles.agent}>
        <Text style={styles.agentName}>
          {meta?.icon} {t(`agents.names.${run.agent}`)}
        </Text>
        {run.status === 'running' && (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.muted}>
              {run.agent === 'designer' ? t('agents.drawing') : t('agents.writing')}
            </Text>
          </View>
        )}
        {run.status === 'failed' && <ErrorText>{run.error ?? t('common.error')}</ErrorText>}
        {result && (
          <>
            {result.files.length > 0 && <Images paths={result.files} />}
            {!!result.text && (
              <Text selectable style={styles.text}>
                {result.text}
              </Text>
            )}
            {!!result.caption && (
              <Text selectable style={styles.text}>
                {result.caption}
              </Text>
            )}
            {result.needs_image_key && <Text style={styles.muted}>{t('agents.needImageKey')}</Text>}
            <View style={styles.actions}>
              <Action title={copied ? `✓ ${t('agents.copied')}` : t('agents.copy')} onPress={copy} />
              {run.deliverable_id && run.task_id ? (
                <Link href={`/tasks/${run.task_id}`} style={styles.link}>
                  ✓ {t('agents.attached')} →
                </Link>
              ) : (
                <Action title={`📌 ${t('agents.toTask')}`} onPress={() => setAttaching((v) => !v)} />
              )}
            </View>
            {attaching && !run.deliverable_id && (
              <AttachToTask
                runId={run.id}
                agent={run.agent}
                onDone={() => {
                  setAttaching(false);
                  onChanged();
                }}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

// Картинки крупно, с настоящими пропорциями; нажатие — открыть/скачать оригинал.
function Images({ paths }: { paths: string[] }) {
  const { t } = useI18n();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const key = paths.join('|');

  useEffect(() => {
    signedUrls(key.split('|'), 'agent-files')
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [key]);

  return (
    <View style={{ gap: 8 }}>
      {paths.map((path) =>
        urls[path] ? (
          <View key={path} style={{ gap: 4 }}>
            <Image
              source={{ uri: urls[path] }}
              style={[styles.image, { aspectRatio: ratios[path] ?? 0.8 }]}
              resizeMode="cover"
              onLoad={(e) => {
                const { width, height } = e.nativeEvent.source;
                if (width && height) setRatios((r) => ({ ...r, [path]: width / height }));
              }}
            />
            <Action title={`⬇️ ${t('agents.download')}`} onPress={() => WebBrowser.openBrowserAsync(urls[path])} />
          </View>
        ) : (
          <View key={path} style={[styles.image, styles.placeholder]} />
        ),
      )}
    </View>
  );
}

function Action({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Text style={styles.actionText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pair: { gap: 8 },
  mine: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: colors.primary,
  },
  mineText: { fontSize: 15, color: colors.primaryText },
  agent: {
    alignSelf: 'stretch',
    gap: 8,
    padding: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  agentName: { fontSize: 13, fontWeight: '600', color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { fontSize: 14, color: colors.muted },
  text: { fontSize: 15, lineHeight: 22, color: colors.text },
  image: { width: '100%', borderRadius: 12, backgroundColor: colors.border },
  placeholder: { aspectRatio: 0.8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  link: { fontSize: 14, fontWeight: '600', color: colors.primary, paddingVertical: 6 },
});
