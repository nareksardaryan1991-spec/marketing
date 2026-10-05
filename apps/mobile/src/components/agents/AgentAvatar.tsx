import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { Agent } from '@/lib/agents';

import { colors } from '../theme';

// Аватар агента. expo-image показывает и временный SVG, и будущую иллюстрацию (PNG/JPG).
export function AgentAvatar({ agent, size = 40 }: { agent: Agent; size?: number }) {
  return (
    <Image
      source={agent.avatar}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: agent.color }}
      contentFit="cover"
    />
  );
}

// «Ани · SMM»; у AI-менеджера имени нет — только «AI-менеджер».
export function agentLabel(t: (key: string) => string, agent: Agent): string {
  return agent.id === 'manager'
    ? t('agents.names.manager')
    : `${t(`agents.names.${agent.id}`)} · ${t(`agents.roles.${agent.id}`)}`;
}

// Аватар, имя и роль в одну строку — для заголовков сообщений и списков.
export function AgentTag({ agent, size = 28 }: { agent: Agent; size?: number }) {
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <AgentAvatar agent={agent} size={size} />
      <Text style={styles.name}>{agentLabel(t, agent)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
});
