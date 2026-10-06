import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Choice } from '@/components/Choice';
import { DateTimeField } from '@/components/DateTimeField';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { dayKey } from '@/lib/datetime';
import { formatDate } from '@/lib/format';
import { roleLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { OrderStatus, Profile, Task, TaskPriority } from '@/lib/types';

const NONE = '';
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

type OrderRow = { id: string; created_at: string; status: OrderStatus };

// Новая задача команды или изменение существующей (?id=). Ставят владелец и менеджеры.
// Название и описание можно передать заранее (?title=&description=) — например, из работы AI-агента.
export default function TeamTaskEditScreen() {
  const params = useLocalSearchParams<{ id?: string; title?: string; description?: string }>();
  const { t, language } = useI18n();
  const editing = !!params.id;
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState(params.description ?? '');
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
      : await supabase.rpc('create_team_task', fields);
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    // Новую задачу открываем: там можно прикрепить файлы к заданию.
    if (editing) router.back();
    else router.replace(`/tasks/${result.data as string}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: editing ? t('teamTasks.editTitle') : t('teamTasks.new') }} />
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
      <Button title={editing ? t('common.save') : t('teamTasks.create')} onPress={save} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 8 },
  hint: { fontSize: 14, color: colors.muted },
});
