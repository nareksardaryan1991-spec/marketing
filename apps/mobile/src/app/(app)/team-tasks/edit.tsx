import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { agentLabel } from '@/components/agents/AgentAvatar';
import { Choice } from '@/components/Choice';
import { DateTimeField } from '@/components/DateTimeField';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { dayKey } from '@/lib/datetime';
import { formatDate } from '@/lib/format';
import { copyDraftFiles, loadAgentDraft, type AgentDraft } from '@/lib/handoff';
import { roleLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { OrderStatus, Profile, Task, TaskPriority } from '@/lib/types';

const NONE = '';
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

type OrderRow = { id: string; created_at: string; status: OrderStatus };

// Новая задача команды или изменение существующей (?id=). Ставят владелец и менеджеры.
// ?from_run= — «Передать человеку»: задача из работы AI-агента, черновик прикрепляется к ней.
export default function TeamTaskEditScreen() {
  const params = useLocalSearchParams<{ id?: string; from_run?: string }>();
  const { t, language } = useI18n();
  const editing = !!params.id;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState(NONE);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [business, setBusiness] = useState(NONE);
  const [order, setOrder] = useState(NONE);
  const [people, setPeople] = useState<Profile[]>([]);
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  // Заказы запоминаем вместе с клиентом: при смене клиента старый список не показываем.
  const [ordersOf, setOrdersOf] = useState<{ business: string; rows: OrderRow[] }>({ business: NONE, rows: [] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  // Задача уже создана, но файлы черновика не скопировались — второй раз не создаём.
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .not('role', 'in', '(client,pending)')
      .order('full_name')
      .then(({ data }) => setPeople((data as Profile[] | null) ?? []));
    supabase
      .from('businesses')
      .select('id, name')
      .order('name')
      .then(({ data }) => setBusinesses(data ?? []));
  }, []);

  useEffect(() => {
    if (!params.id) return;
    supabase
      .from('tasks')
      .select('*')
      .eq('id', params.id)
      .single<Task>()
      .then(({ data, error }) => {
        if (error || !data) {
          setError(error?.message ?? null);
          return;
        }
        setTitle(data.title ?? '');
        setDescription(data.brief ?? '');
        setAssignee(data.assignee_id ?? NONE);
        // due_date — день без времени: собираем локальную дату, чтобы не сдвинул часовой пояс.
        if (data.due_date) {
          const [y, m, d] = data.due_date.split('-').map(Number);
          setDueDate(new Date(y, m - 1, d));
        }
        setPriority(data.priority);
        setBusiness(data.business_id ?? NONE);
        setOrder(data.related_order_id ?? NONE);
      });
  }, [params.id]);

  // «Передать человеку»: название, описание с текстом черновика, клиент и заказ исходной работы.
  useEffect(() => {
    if (!params.from_run || params.id) return;
    loadAgentDraft(params.from_run)
      .then((d) => {
        setDraft(d);
        const request = d.instructions?.trim();
        setTitle(
          `${t('teamTasks.finishDraft')}: ${
            request ? (request.length > 60 ? `${request.slice(0, 60)}…` : request) : d.agent ? agentLabel(t, d.agent) : ''
          }`,
        );
        setDescription(
          [d.text, request ? `${t('teamTasks.agentRequest')}: «${request}»` : null].filter(Boolean).join('\n\n'),
        );
        if (d.businessId) setBusiness(d.businessId);
        if (d.orderId) setOrder(d.orderId);
      })
      .catch((e: Error) => setError(e.message));
  }, [params.from_run, params.id, t]);

  // Заказы выбранного клиента — чтобы привязать задачу к конкретному заказу.
  useEffect(() => {
    if (!business) return;
    supabase
      .from('orders')
      .select('id, created_at, status')
      .eq('business_id', business)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setOrdersOf({ business, rows: (data as OrderRow[] | null) ?? [] }));
  }, [business]);

  const orders = business && ordersOf.business === business ? ordersOf.rows : [];

  const save = async () => {
    if (createdId) {
      router.replace(`/tasks/${createdId}`);
      return;
    }
    if (!title.trim()) {
      setError(t('teamTasks.titleRequired'));
      return;
    }
    setError(null);
    setSaving(true);
    const fields = {
      p_title: title,
      p_description: description,
      p_assignee_id: assignee || null,
      p_due_date: dueDate ? dayKey(dueDate) : null,
      p_priority: priority,
      p_business_id: business || null,
      p_order_id: order || null,
    };
    const result = editing
      ? await supabase.rpc('update_team_task', { p_task_id: params.id, ...fields })
      : await supabase.rpc('create_team_task', { ...fields, p_from_run_id: draft?.runId ?? null });
    if (result.error) {
      setSaving(false);
      setError(result.error.message);
      return;
    }
    if (editing) {
      setSaving(false);
      router.back();
      return;
    }
    const taskId = result.data as string;
    // Файлы черновика агента — копии в папке задачи.
    if (draft?.files.length) {
      try {
        const files = await copyDraftFiles(draft, taskId);
        const { error } = await supabase.rpc('set_team_task_attachments', { p_task_id: taskId, p_files: files });
        if (error) throw error;
      } catch (e) {
        setSaving(false);
        setCreatedId(taskId);
        setError(`${t('teamTasks.draftFilesFailed')} ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setSaving(false);
    // Новую задачу открываем: там можно прикрепить файлы к заданию.
    router.replace(`/tasks/${taskId}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: editing ? t('teamTasks.editTitle') : t('teamTasks.new') }} />
      {draft && (
        <Card>
          <Text style={styles.cardTitle}>🤖 {t('teamTasks.fromAgent', { agent: draft.agent ? agentLabel(t, draft.agent) : '' })}</Text>
          <Text style={styles.hint}>
            {t('teamTasks.draftAttached', { count: draft.files.length })}
          </Text>
        </Card>
      )}
      <Card>
        <Field label={t('teamTasks.name')} value={title} maxLength={200} onChangeText={setTitle} />
        <Field
          label={t('teamTasks.description')}
          hint={t('teamTasks.descriptionHint')}
          multiline
          value={description}
          onChangeText={setDescription}
        />
        <DateTimeField label={t('task.dueDate')} mode="date" value={dueDate} onChange={setDueDate} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('teamTasks.assignee')}</Text>
        <Choice
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: NONE, label: t('task.unassigned') },
            ...people.map((person) => ({
              value: person.id,
              label: person.full_name || person.email || person.id.slice(0, 8),
              hint: roleLabel(t, person),
            })),
          ]}
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('teamTasks.priorityTitle')}</Text>
        <Choice
          value={priority}
          onChange={setPriority}
          options={PRIORITIES.map((p) => ({ value: p, label: t(`teamTasks.priority.${p}`) }))}
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('teamTasks.client')}</Text>
        <Text style={styles.hint}>{t('teamTasks.clientHint')}</Text>
        <Choice
          value={business}
          onChange={(value) => {
            setBusiness(value);
            setOrder(NONE);
          }}
          options={[
            { value: NONE, label: t('teamTasks.noClient') },
            ...businesses.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        {orders.length > 0 && (
          <>
            <Text style={styles.label}>{t('teamTasks.order')}</Text>
            <Choice
              value={order}
              onChange={setOrder}
              options={[
                { value: NONE, label: t('teamTasks.noOrder') },
                ...orders.map((o) => ({
                  value: o.id,
                  label: `${t('order.order')} ${formatDate(o.created_at, language)}`,
                  hint: t(`orderStatus.${o.status}`),
                })),
              ]}
            />
          </>
        )}
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button
        title={createdId ? t('teamTasks.openTask') : editing ? t('common.save') : t('teamTasks.create')}
        onPress={save}
        loading={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 8 },
  hint: { fontSize: 14, color: colors.muted },
});
