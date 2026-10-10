import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { isManagerRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { confirm } from '@/lib/confirm';
import {
  filterTeamTasks,
  NO_FILTERS,
  sortTeamTasks,
  TEAM_STAGES,
  teamStage,
  type TeamFilters,
  type TeamMove,
  type TeamStage,
  type TeamTaskRow,
} from '@/lib/teamTasks';
import type { TeamProject } from '@/lib/types';
import { useUnreadTaskNotifications } from '@/lib/useBadges';
import { useAuth } from '@/providers/AuthProvider';

import { colors } from '../theme';
import { Button, ErrorText } from '../ui';
import { TeamBoard } from './TeamBoard';
import { TeamFiltersBar } from './TeamFiltersBar';
import { TeamTaskItem, type Person } from './TeamTaskItem';

// Готовых задач загружаем только последние — иначе список растёт бесконечно.
const DONE_LIMIT = 100;
const WIDE = 900;

// Раздел «Задачи команды»: список с поиском и фильтрами или доска по этапам; «Мои задачи» — где я исполнитель.
// Что человек видит, решает база (владелец и менеджеры — все задачи команды, остальные — свои и отмеченные).
export function TeamTasks() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const manager = isManagerRole(profile?.role);
  const owner = profile?.role === 'admin';
  const wide = useWindowDimensions().width >= WIDE;
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filters, setFilters] = useState<TeamFilters>({ scope: manager ? 'all' : 'mine', ...NO_FILTERS });
  const [tasks, setTasks] = useState<TeamTaskRow[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const unread = useUnreadTaskNotifications(!!profile);

  const load = useCallback(() => {
    const select = '*, businesses(name), team_projects(name)';
    Promise.all([
      supabase.from('tasks').select(select).eq('kind', 'team').neq('status', 'approved'),
      supabase
        .from('tasks')
        .select(select)
        .eq('kind', 'team')
        .eq('status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(DONE_LIMIT),
      supabase
        .from('profiles')
        .select('id, full_name, email, avatar_path, accent_color')
        .not('role', 'in', '(client,pending)')
        .order('full_name'),
      supabase.from('team_projects').select('*').order('name'),
    ]).then(([open, done, p, pr]) => {
      setError(open.error?.message ?? done.error?.message ?? p.error?.message ?? pr.error?.message ?? null);
      setTasks([...((open.data as TeamTaskRow[] | null) ?? []), ...((done.data as TeamTaskRow[] | null) ?? [])]);
      setPeople((p.data as Person[] | null) ?? []);
      setProjects((pr.data as TeamProject[] | null) ?? []);
    });
  }, []);

  useFocusEffect(load);

  // Перемещение с доски. Смена этапа видна сразу, при ошибке доска перечитывается. Сдать результат и вернуть
  // работу — на экране задачи (там поле для результата или комментария), принять — после подтверждения.
  const move = async (task: TeamTaskRow, to: TeamStage, how: TeamMove) => {
    if (how === 'submit' || how === 'return') {
      router.push(`/tasks/${task.id}`);
      return;
    }
    if (how === 'accept' && !(await confirm(t('teamTasks.board.acceptConfirm', { title: task.title ?? '' })))) return;
    const status = TEAM_STAGES.find((s) => s.key === to)!.status;
    setError(null);
    setTasks((all) => all.map((row) => (row.id === task.id ? { ...row, status } : row)));
    const { error } =
      how === 'accept'
        ? await supabase.rpc('review_task', { p_task_id: task.id, p_approve: true })
        : await supabase.rpc('set_team_task_status', { p_task_id: task.id, p_status: status });
    if (error) {
      setError(error.message);
      load();
    }
  };

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nameOf = useCallback(
    (id: string) => {
      const p = byId.get(id);
      return p?.full_name || p?.email || '';
    },
    [byId],
  );

  // В фильтрах — только люди и проекты, по которым есть задачи (и действующие проекты).
  const peopleOptions = useMemo(() => {
    const ids = new Set(tasks.map((task) => task.assignee_id).filter(Boolean) as string[]);
    return people.filter((p) => ids.has(p.id)).map((p): [string, string] => [p.id, nameOf(p.id)]);
  }, [tasks, people, nameOf]);
  const projectOptions = useMemo(() => {
    const used = new Set(tasks.map((task) => task.project_id));
    return projects.filter((p) => !p.archived || used.has(p.id)).map((p): [string, string] => [p.id, p.name]);
  }, [tasks, projects]);

  const list = view === 'list';
  const shown = sortTeamTasks(filterTeamTasks(tasks, filters, profile?.id, nameOf, list));
  const open = tasks.filter((task) => teamStage(task.status) !== 'done');
  const counts = {
    mine: open.filter((task) => task.assignee_id === profile?.id).length,
    all: open.length,
    overdue: filterTeamTasks(tasks, { ...filters, due: 'overdue' }, profile?.id, nameOf, false).length,
  };
  const anyFilter =
    filters.search.trim() !== '' || (Object.keys(NO_FILTERS) as (keyof typeof NO_FILTERS)[]).some(
      (key) => key !== 'stage' && filters[key] !== NO_FILTERS[key],
    );
  const emptyText = t(
    anyFilter ? 'teamTasks.emptyFiltered' : filters.scope === 'mine' ? 'teamTasks.emptyMine' : 'board.empty',
  );

  const item = (task: TeamTaskRow, showStatus: boolean) => (
    <TeamTaskItem
      key={task.id}
      task={task}
      person={task.assignee_id ? byId.get(task.assignee_id) : undefined}
      showStatus={showStatus}
      unassignedLabel={t('board.noAssignee')}
    />
  );

  const toggle = (key: 'list' | 'board', label: string) => (
    <Pressable
      key={key}
      accessibilityRole="tab"
      accessibilityState={{ selected: view === key }}
      onPress={() => setView(key)}
      style={[styles.segment, view === key && styles.segmentSelected]}>
      <Text style={[styles.segmentText, view === key && styles.segmentTextSelected]}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.header}>
        <View style={styles.segments}>
          {toggle('list', `☰ ${t('teamTasks.view.list')}`)}
          {toggle('board', `▦ ${t('teamTasks.view.board')}`)}
        </View>
        <View style={styles.actions}>
          {/* Лента уведомлений по задачам: назначили, сменился статус, комментарий, сроки. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('teamTasks.inbox.title')}
            onPress={() => router.push('/team-tasks/inbox')}
            style={styles.bell}>
            <Text style={styles.bellText}>🔔</Text>
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </Pressable>
          {owner && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/team-tasks/projects')} style={styles.link}>
              <Text style={styles.linkText}>{t('teamTasks.projects.title')}</Text>
            </Pressable>
          )}
          {manager && <Button title={`＋ ${t('teamTasks.new')}`} onPress={() => router.push('/team-tasks/edit')} />}
        </View>
      </View>
      <TeamFiltersBar
        filters={filters}
        onChange={setFilters}
        counts={counts}
        people={peopleOptions}
        projects={projectOptions}
        withStage={list}
      />
      <ErrorText>{error}</ErrorText>

      {list ? (
        <ScrollView contentContainerStyle={[styles.list, wide && styles.listWide]}>
          {shown.length === 0 && <Text style={styles.empty}>{emptyText}</Text>}
          {shown.map((task) => item(task, true))}
        </ScrollView>
      ) : (
        <TeamBoard tasks={shown} byId={byId} user={profile ? { id: profile.id, role: profile.role } : null} onMove={move} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  segments: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, padding: 3 },
  segment: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segmentSelected: { backgroundColor: colors.surfaceAlt },
  segmentText: { fontSize: 14, color: colors.muted },
  segmentTextSelected: { color: colors.text, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  link: { paddingHorizontal: 8, paddingVertical: 8 },
  bell: { padding: 6 },
  bellText: { fontSize: 22 },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: colors.dangerText, fontSize: 11, fontWeight: '700' },
  linkText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  list: { gap: 8, padding: 12 },
  listWide: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 16 },
});
