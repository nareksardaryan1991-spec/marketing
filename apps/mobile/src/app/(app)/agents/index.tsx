import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { AgentRuns } from '@/components/agents/AgentRuns';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { useI18n } from '@/i18n';
import { AGENTS } from '@/lib/agents';
import { isManagerRole } from '@/lib/roles';
import { useAuth } from '@/providers/AuthProvider';

// Команда AI-агентов: нажали на агента → дали задачу → он сделал и отправил на проверку.
export default function AgentsScreen() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const agents = AGENTS.filter((a) => a.id !== 'manager' || isManagerRole(profile?.role));

  return (
    <Screen>
      <Text style={styles.hint}>{t('agents.intro')}</Text>
      <View style={styles.grid}>
        {agents.map((agent) => (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            onPress={() => router.push(`/agents/${agent.id}`)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
            <AgentAvatar agent={agent} size={56} />
            <Text style={styles.name}>{t(`agents.names.${agent.id}`)}</Text>
            {agent.id !== 'manager' && (
              <Text style={styles.role}>{t(`agents.roles.${agent.id}`)}</Text>
            )}
            <Text style={styles.does}>{t(`agents.does.${agent.id}`)}</Text>
          </Pressable>
        ))}
      </View>
      <AgentRuns />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 15, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    gap: 6,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  role: { fontSize: 14, fontWeight: '500', color: colors.text },
  does: { fontSize: 14, color: colors.muted },
});
