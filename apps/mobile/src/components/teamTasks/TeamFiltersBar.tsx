import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/i18n';
import { NO_FILTERS, PRIORITIES, TEAM_STAGES, type TeamFilters } from '@/lib/teamTasks';

import { colors } from '../theme';

type Option = { value: string; label: string };
type FilterKey = 'assignee' | 'project' | 'priority' | 'due' | 'stage';

// Поиск, «Мои / Все», «Просроченные» и фильтры. Фильтр — кнопка с выбранным значением; нажатие раскрывает
// варианты строкой ниже (без всплывающих окон — одинаково на телефоне и в браузере).
export function TeamFiltersBar({
  filters,
  onChange,
  counts,
  people,
  projects,
  withStage,
}: {
  filters: TeamFilters;
  onChange: (filters: TeamFilters) => void;
  counts: { mine: number; all: number; overdue: number };
  // Люди и проекты, по которым есть задачи: [id, имя].
  people: [string, string][];
  projects: [string, string][];
  // Фильтр по статусу — только в списке (на доске статусы — колонки).
  withStage: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<FilterKey | null>(null);
  const set = (patch: Partial<TeamFilters>) => onChange({ ...filters, ...patch });

  const options: Record<FilterKey, Option[]> = {
    assignee: [
      { value: 'all', label: t('teamTasks.filter.anyone') },
      { value: 'none', label: t('board.noAssignee') },
      ...people.map(([value, label]) => ({ value, label })),
    ],
    project: [
      { value: 'all', label: t('teamTasks.filter.anyProject') },
      { value: 'none', label: t('teamTasks.noProject') },
      ...projects.map(([value, label]) => ({ value, label })),
    ],
    priority: [
      { value: 'all', label: t('teamTasks.filter.anyPriority') },
      ...PRIORITIES.map((p) => ({ value: p, label: t(`teamTasks.priority.${p}`) })),
    ],
    due: [
      { value: 'all', label: t('teamTasks.filter.anyDue') },
      ...(['overdue', 'today', 'week', 'none'] as const).map((d) => ({ value: d, label: t(`teamTasks.dueFilter.${d}`) })),
    ],
    stage: [
      { value: 'open', label: t('teamTasks.filter.open') },
      { value: 'all', label: t('teamTasks.allStatuses') },
      ...TEAM_STAGES.map((s) => ({ value: s.key, label: t(`teamTasks.status.${s.key}`) })),
    ],
  };
  const keys: FilterKey[] = [
    ...(filters.scope === 'all' ? (['assignee'] as const) : []),
    'project',
    'priority',
    'due',
    ...(withStage ? (['stage'] as const) : []),
  ];
  const valueLabel = (key: FilterKey) => options[key].find((o) => o.value === filters[key])?.label ?? '';
  const isSet = (key: FilterKey) => filters[key] !== NO_FILTERS[key];
  const anySet = filters.search.trim() !== '' || keys.some(isSet);

  const chip = (key: string, label: string, selected: boolean, onPress: () => void, tone?: 'danger') => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && (tone === 'danger' ? styles.chipDanger : styles.chipSelected)]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      <TextInput
        value={filters.search}
        onChangeText={(search) => set({ search })}
        placeholder={t('teamTasks.search')}
        placeholderTextColor={colors.muted}
        style={styles.search}
        accessibilityLabel={t('teamTasks.search')}
        clearButtonMode="while-editing"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
        {chip('mine', `${t('teamTasks.mine')} ${counts.mine}`, filters.scope === 'mine', () =>
          set({ scope: 'mine', assignee: 'all' }),
        )}
        {chip('all', `${t('teamTasks.allTasks')} ${counts.all}`, filters.scope === 'all', () => set({ scope: 'all' }))}
        {(counts.overdue > 0 || filters.due === 'overdue') &&
          chip(
            'overdue',
            `🔴 ${t('board.overdue')} ${counts.overdue}`,
            filters.due === 'overdue',
            () => set({ due: filters.due === 'overdue' ? 'all' : 'overdue' }),
            'danger',
          )}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
        {keys.map((key) =>
          chip(
            `f-${key}`,
            `${t(`teamTasks.filter.${key}`)}${isSet(key) ? `: ${valueLabel(key)}` : ''} ${open === key ? '▴' : '▾'}`,
            isSet(key),
            () => setOpen(open === key ? null : key),
          ),
        )}
        {anySet && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange({ ...NO_FILTERS, scope: filters.scope });
              setOpen(null);
            }}
            style={styles.reset}>
            <Text style={styles.resetText}>{t('teamTasks.filter.reset')}</Text>
          </Pressable>
        )}
      </ScrollView>
      {open && keys.includes(open) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips}>
          {options[open].map((o) =>
            chip(`o-${o.value}`, o.label, filters[open] === o.value, () => {
              set({ [open]: o.value } as Partial<TeamFilters>);
              setOpen(null);
            }),
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 6, paddingTop: 10 },
  search: {
    marginHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  // Горизонтальная полоса не должна растягиваться по высоте.
  strip: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 6, paddingHorizontal: 12, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.primaryText, fontWeight: '600' },
  reset: { paddingHorizontal: 8, paddingVertical: 6 },
  resetText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
});
