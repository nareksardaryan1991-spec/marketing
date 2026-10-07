import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { TaskPreview } from '@/components/approval/TaskPreview';
import { AgentLaunch } from '@/components/agents/AgentLaunch';
import { AgentRuns } from '@/components/agents/AgentRuns';
import { AssistantCard } from '@/components/AssistantCard';
import { Screen } from '@/components/Screen';
import { AssignPanel } from '@/components/task/AssignPanel';
import { BriefCard } from '@/components/task/BriefCard';
import { ClientFeedback, type Approval } from '@/components/task/ClientFeedback';
import { Comments } from '@/components/task/Comments';
import { PublishPanel } from '@/components/task/PublishPanel';
import { ReviewPanel } from '@/components/task/ReviewPanel';
import { TaskHistory } from '@/components/task/TaskHistory';
import { TeamTaskCard } from '@/components/task/TeamTaskCard';
import { Versions } from '@/components/task/Versions';
import { WorkPanel } from '@/components/task/WorkPanel';
import { TaskStatusBadge } from '@/components/TaskStatusBadge';
import { colors } from '@/components/theme';
import { ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { AGENT_TASK_STATUSES, agentsForService } from '@/lib/agents';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Business, Deliverable, Localized, Task, TaskComment } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { canUseAgents, isManagerRole, isTeamRole } from '@/lib/roles';

type TaskRow = Task & {
  services: { name: Localized } | null;
  businesses: Business | null;
};

const WORKING_STATUSES = ['assigned', 'in_progress', 'changes_requested'];

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [versions, setVersions] = useState<Deliverable[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [orderNotes, setOrderNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Меняется после каждого действия, чтобы панели пересоздались с новыми данными.
  const [revision, setRevision] = useState(0);
  const [agentRefresh, setAgentRefresh] = useState(0);

  const load = useCallback(async () => {
    const [taskRes, versionsRes, notesRes, commentsRes, approvalsRes, orderNotesRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, services(name), businesses(*)')
        .eq('id', id)
        .single<TaskRow>(),
      supabase
        .from('deliverables')
        .select('*')
        .eq('task_id', id)
        .order('version', { ascending: false }),
      // Клиенту правила базы не отдают заметки — придёт пустой список.
      supabase.from('deliverable_notes').select('deliverable_id, note').eq('task_id', id),
      supabase.from('task_comments').select('*').eq('task_id', id).order('created_at'),
      supabase
        .from('approvals')
        .select('id, deliverable_id, decision, comment, auto, created_at, approval_marks(position, file_path, x, y, at_seconds, note)')
        .eq('task_id', id)
        .order('created_at', { ascending: false })
        .order('position', { referencedTable: 'approval_marks' }),
      // Пожелания клиента — через функцию: сотруднику сам заказ (с суммами) не виден.
      supabase.rpc('task_order_notes', { p_task_id: id }),
    ]);
    setOrderNotes((orderNotesRes.data as string | null) ?? null);
    setApprovals((approvalsRes.data as Approval[] | null) ?? []);
    setError(taskRes.error?.message ?? null);
    setTask(taskRes.data ?? null);
    const notes = new Map(
      ((notesRes.data as { deliverable_id: string; note: string }[] | null) ?? []).map((n) => [n.deliverable_id, n.note]),
    );
    setVersions(
      ((versionsRes.data as Deliverable[] | null) ?? []).map((v) => ({ ...v, note: notes.get(v.id) ?? null })),
    );
    const commentRows = (commentsRes.data as TaskComment[] | null) ?? [];
    setComments(commentRows);

    // Имена авторов комментариев, а у задачи команды — ещё автора, исполнителя и проверяющего.
    const authorIds = [
      ...new Set(
        [
          ...commentRows.map((c) => c.author_id),
          taskRes.data?.kind === 'team' ? taskRes.data.assignee_id : null,
          taskRes.data?.kind === 'team' ? taskRes.data.created_by : null,
          taskRes.data?.kind === 'team' ? (taskRes.data.reviewer_id ?? null) : null,
        ].filter((v): v is string => !!v),
      ),
    ];
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
  const isOwner = profile.role === 'admin';
  // Задача команды: без клиента на согласовании, публикации и AI-агентов.
  const team = task.kind === 'team';
  const canWork = isAssignee && WORKING_STATUSES.includes(task.status);
  // Поручить агенту может тот же, кто может сдать версию: исполнитель или менеджер.
  const taskAgents = team || !task.service_id ? [] : agentsForService(task.service_id);
  const showAgentLaunch =
    (isAssignee || isManager) &&
    canUseAgents(profile.role) &&
    taskAgents.length > 0 &&
    (AGENT_TASK_STATUSES as readonly string[]).includes(task.status);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>
          {taskTitle(task, task.services?.name, language)}
        </Text>
        <TaskStatusBadge status={task.status} kind={task.kind} />
      </View>

      {team ? (
        <>
          <TeamTaskCard
            key={`team-${revision}`}
            task={task}
            businessName={task.businesses?.name ?? null}
            people={authors}
            // Менять и удалять задачу команды — автор и владелец (как в базе, can_edit_team_task).
            canEdit={isOwner || (isManager && task.created_by === profile.id)}
            onChanged={reload}
          />
          {/* Задача про клиента — его профиль под рукой, без пожеланий к заказу. */}
          {task.businesses && <BriefCard business={task.businesses} orderNotes={null} brief={null} dueDate={null} />}
        </>
      ) : (
        <>
          <BriefCard
            business={task.businesses}
            orderNotes={orderNotes}
            brief={task.brief}
            dueDate={task.due_date}
          />
          <ClientFeedback
            approvals={approvals}
            versions={versions}
            serviceId={task.service_id ?? ''}
            name={task.businesses?.name ?? ''}
          />
        </>
      )}

      {/* Задачу команды видят только её участники — помощник им всем. Без клиента — без брифа и правок клиента. */}
      {(team || isStaff || isAssignee) && (
        <AssistantCard
          taskId={task.id}
          hint={team ? t(task.business_id ? 'assistant.taskHintTeamClient' : 'assistant.taskHintTeam') : undefined}
        />
      )}

      {showAgentLaunch && (
        <AgentLaunch
          key={`agent-${revision}`}
          agents={taskAgents}
          taskId={task.id}
          onStarted={() => setAgentRefresh((k) => k + 1)}
        />
      )}
      {!team && (isStaff || isAssignee) && (
        <AgentRuns taskId={task.id} refreshKey={agentRefresh} onFinished={reload} />
      )}

      {/* Задачу команды принимает проверяющий (или владелец), работу по заказу — менеджер. */}
      {(team ? isOwner || task.reviewer_id === profile.id : isManager) && task.status === 'internal_review' && (
        <ReviewPanel
          key={`review-${revision}`}
          taskId={task.id}
          kind={task.kind}
          agent={versions[0]?.agent ?? null}
          onDone={reload}
        />
      )}

      {canWork && (
        <WorkPanel
          key={`work-${revision}`}
          task={task}
          lastVersion={versions[0] ?? null}
          onChanged={reload}
        />
      )}

      {!team && isStaff && (
        <PublishPanel key={`publish-${revision}`} task={task} onChanged={reload} />
      )}

      {!team && task.service_id && versions[0] && versions[0].files.length > 0 && (
        <TaskPreview
          version={versions[0]}
          serviceId={task.service_id}
          name={task.businesses?.name ?? ''}
        />
      )}

      <Versions versions={versions} />

      <Comments
        taskId={task.id}
        userId={profile.id}
        comments={comments}
        authors={authors}
        onAdded={load}
      />

      {team && <TaskHistory key={`history-${revision}`} taskId={task.id} />}

      {!team && isManager && <AssignPanel key={`assign-${revision}`} task={task} onSaved={reload} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text },
});
