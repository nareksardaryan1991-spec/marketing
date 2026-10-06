import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { DueBadge } from '@/components/DueBadge';
import { colors } from '@/components/theme';
import { ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { dueTone } from '@/lib/due';
import { taskTitle } from '@/lib/platforms';
import { isManagerRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Localized, Profile, Task, TaskStatus } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

type Row = Task & {
  services: { name: Localized } | null;
  businesses: { name: string } | null;
};

type Person = Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_path' | 'accent_color'>;

// Колонки доски — этапы работы над задачей.
const COLUMNS: { key: string; statuses: TaskStatus[]; color: string }[] = [
  { key: 'new', statuses: ['new'], color: '#F59E0B' },
  { key: 'work', statuses: ['assigned', 'in_progress', 'changes_requested'], color: '#6366F1' },
  { key: 'review', statuses: ['internal_review'], color: '#A855F7' },
  { key: 'client', statuses: ['client_review'], color: '#EC4899' },
  { key: 'publish', statuses: ['approved', 'publishing'], color: '#14B8A6' },
  { key: 'done', statuses: ['published'], color: '#6B7280' },
];

// Опубликованных показываем только последние — иначе колонка растёт бесконечно.
const DONE_LIMIT = 20;
const WIDE = 900;

// Доска задач: менеджер и владелец видят все задачи, сотрудник — свои.
export default function BoardScreen() {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const manager = isManagerRole(profile?.role);
  const wide = useWindowDimensions().width >= WIDE;
  const [tasks, setTasks] = useState<Row[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string>('all');
  const [business, setBusiness] = useState<string>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [column, setColumn] = useState('work');

  useFocusEffect(
    useCallback(() => {
      const select = '*, services(name), businesses(name)';
      let active = supabase.from('tasks').select(select).neq('status', 'published').order('due_date', {
        ascending: true,
        nullsFirst: false,
      });
      let done = supabase
        .from('tasks')
        .select(select)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(DONE_LIMIT);
      if (!manager && profile) {
        active = active.eq('assignee_id', profile.id);
        done = done.eq('assignee_id', profile.id);
      }
      Promise.all([
        active,
        done,
        manager
          ? supabase
              .from('profiles')
              .select('id, full_name, email, avatar_path, accent_color')
              .not('role', 'in', '(client,pending)')
              .order('full_name')
          : Promise.resolve({ data: [] as Person[], error: null }),
      ]).then(([a, d, p]) => {
        setError(a.error?.message ?? d.error?.message ?? p.error?.message ?? null);
        setTasks([...((a.data as Row[] | null) ?? []), ...((d.data as Row[] | null) ?? [])]);
        setPeople((p.data as Person[] | null) ?? []);
      });
    }, [manager, profile]),
  );

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const businesses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of tasks) if (task.businesses) seen.set(task.business_id, task.businesses.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const shown = tasks.filter(
    (task) =>
      (assignee === 'all' || (assignee === 'none' ? !task.assignee_id : task.assignee_id === assignee)) &&
      (business === 'all' || task.business_id === business) &&
      (!overdueOnly || dueTone(task.due_date, task.status) === 'overdue'),
  );
  const columnTasks = (key: string) => {
    const statuses = COLUMNS.find((c) => c.key === key)!.statuses;
    return shown.filter((task) => statuses.includes(task.status));
  };

  const card = (task: Row) => {
    const person = task.assignee_id ? byId.get(task.assignee_id) : undefined;
    const overdue = dueTone(task.due_date, task.status) === 'overdue';
    return (
      <Link key={task.id} href={`/tasks/${task.id}`} asChild>
        {/* Link asChild передаёт стиль прямо в DOM — только одним объектом, не списком. */}
        <Pressable style={StyleSheet.flatten([styles.card, overdue && styles.cardOverdue])}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {taskTitle(task, task.services?.name, language)}
          </Text>
          {!!task.businesses?.name && <Text style={styles.cardBusiness}>{task.businesses.name}</Text>}
          <View style={styles.cardFooter}>
            <View style={styles.flex}>
              <DueBadge due={task.due_date} status={task.status} />
            </View>
            {manager &&
              (person ? (
                <Avatar name={person.full_name || person.email || '?'} path={person.avatar_path} color={person.accent_color} size={26} />
              ) : task.assignee_id ? null : (
                <Text style={styles.noAssignee}>{t('board.noAssignee')}</Text>
              ))}
          </View>
        </Pressable>
      </Link>
    );
  };

  const chip = (key: string, label: string, selected: boolean, onPress: () => void, danger = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && (danger ? styles.chipDanger : styles.chipSelected)]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
          {chip('overdue', `🔴 ${t('board.overdue')}`, overdueOnly, () => setOverdueOnly(!overdueOnly), true)}
          {manager && chip('all', t('board.everyone'), assignee === 'all', () => setAssignee('all'))}
          {manager && chip('none', t('board.noAssignee'), assignee === 'none', () => setAssignee('none'))}
          {manager &&
            people.map((p) =>
              chip(p.id, (p.full_name || p.email || '?').split(' ')[0], assignee === p.id, () =>
                setAssignee(assignee === p.id ? 'all' : p.id),
              ),
            )}
        </ScrollView>
        {businesses.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
            {chip('b-all', t('board.allClients'), business === 'all', () => setBusiness('all'))}
            {businesses.map(([id, name]) =>
              chip(id, name, business === id, () => setBusiness(business === id ? 'all' : id)),
            )}
          </ScrollView>
        )}
      </View>
      <ErrorText>{error}</ErrorText>

      {wide ? (
        <ScrollView horizontal contentContainerStyle={styles.columns}>
          {COLUMNS.map((c) => {
            const list = columnTasks(c.key);
            return (
              <View key={c.key} style={styles.column}>
                <View style={styles.columnHeader}>
                  <View style={[styles.dot, { backgroundColor: c.color }]} />
                  <Text style={styles.columnTitle}>{t(`board.${c.key}`)}</Text>
                  <Text style={styles.count}>{list.length}</Text>
                </View>
                <ScrollView contentContainerStyle={styles.cards}>
                  {list.length === 0 && <Text style={styles.empty}>—</Text>}
                  {list.map(card)}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.tabs}>
            {COLUMNS.map((c) => {
              const selected = column === c.key;
              return (
                <Pressable
                  key={c.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setColumn(c.key)}
                  style={[styles.tab, selected && { borderBottomColor: c.color }]}>
                  <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                    {t(`board.${c.key}`)} {columnTasks(c.key).length}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.cards}>
            {columnTasks(column).length === 0 && <Text style={styles.empty}>{t('board.empty')}</Text>}
            {columnTasks(column).map(card)}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  filters: { gap: 6, paddingTop: 10 },
  // Горизонтальная полоса не должна растягиваться по высоте.
  strip: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 6, paddingHorizontal: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDanger: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.primaryText, fontWeight: '600' },
  columns: { gap: 12, padding: 12, flexGrow: 1 },
  column: { width: 280, backgroundColor: '#ECEEF4', borderRadius: 14, padding: 8, gap: 8 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  count: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  tabs: { paddingHorizontal: 8, marginTop: 6 },
  tab: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, color: colors.muted },
  tabTextSelected: { color: colors.text, fontWeight: '700' },
  cards: { gap: 8, padding: 12 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 16 },
  card: {
    gap: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOverdue: { borderColor: '#FCA5A5' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardBusiness: { fontSize: 13, color: colors.muted },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  noAssignee: { fontSize: 12, color: '#B45309' },
});
