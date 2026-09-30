import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { AssignPanel } from '@/components/task/AssignPanel';
import { BriefCard } from '@/components/task/BriefCard';
import { ClientFeedback, type Approval } from '@/components/task/ClientFeedback';
import { Comments } from '@/components/task/Comments';
import { PublishPanel } from '@/components/task/PublishPanel';
import { ReviewPanel } from '@/components/task/ReviewPanel';
import { Versions } from '@/components/task/Versions';
import { WorkPanel } from '@/components/task/WorkPanel';
import { TaskStatusBadge } from '@/components/TaskStatusBadge';
import { colors } from '@/components/theme';
import { ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Business, Deliverable, Localized, Task, TaskComment } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { isManagerRole, isTeamRole } from '@/lib/roles';

type TaskRow = Task & {
  services: { name: Localized } | null;
  businesses: Business | null;
  orders: { notes: string | null } | null;
};

const WORKING_STATUSES = ['assigned', 'in_progress', 'changes_requested'];

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language } = useI18n();
  const { profile } = useAuth();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [versions, setVersions] = useState<Deliverable[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // Меняется после каждого действия, чтобы панели пересоздались с новыми данными.
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    const [taskRes, versionsRes, commentsRes, approvalsRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, services(name), businesses(*), orders(notes)')
        .eq('id', id)
        .single<TaskRow>(),
      supabase
        .from('deliverables')
        .select('*')
        .eq('task_id', id)
        .order('version', { ascending: false }),
      supabase.from('task_comments').select('*').eq('task_id', id).order('created_at'),
      supabase
        .from('approvals')
        .select('id, decision, comment, created_at')
        .eq('task_id', id)
        .order('created_at', { ascending: false }),
    ]);
    setApprovals((approvalsRes.data as Approval[] | null) ?? []);
    setError(taskRes.error?.message ?? null);
    setTask(taskRes.data ?? null);
    setVersions((versionsRes.data as Deliverable[] | null) ?? []);
    const commentRows = (commentsRes.data as TaskComment[] | null) ?? [];
    setComments(commentRows);

    const authorIds = [...new Set(commentRows.map((c) => c.author_id))];
    if (authorIds.length > 0) {
      const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', authorIds);
      setAuthors(
        Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || p.email || '—'])),
      );
    }
  }, [id]);

  const reload = useCallback(async () => {
    await load();
    setRevision((r) => r + 1);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!task || !profile) {
    return (
      <View style={styles.center}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const isManager = isManagerRole(profile.role);
  const isStaff = isTeamRole(profile.role);
  const isAssignee = task.assignee_id === profile.id;
  const canWork = isAssignee && WORKING_STATUSES.includes(task.status);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>
          {taskTitle(task, task.services?.name, language)}
        </Text>
        <TaskStatusBadge status={task.status} />
      </View>

      <BriefCard
        business={task.businesses}
        orderNotes={task.orders?.notes ?? null}
        brief={task.brief}
        dueDate={task.due_date}
      />

      <ClientFeedback approvals={approvals} />

      {isManager && task.status === 'internal_review' && (
        <ReviewPanel key={`review-${revision}`} taskId={task.id} onDone={reload} />
      )}

      {canWork && (
        <WorkPanel
          key={`work-${revision}`}
          task={task}
          lastVersion={versions[0] ?? null}
          onChanged={reload}
        />
      )}

      {isStaff && (
        <PublishPanel key={`publish-${revision}`} task={task} onChanged={reload} />
      )}

      <Versions versions={versions} />

      <Comments
        taskId={task.id}
        userId={profile.id}
        comments={comments}
        authors={authors}
        onAdded={load}
      />

      {isManager && <AssignPanel key={`assign-${revision}`} task={task} onSaved={reload} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text },
});
