import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { useI18n } from '@/i18n';
import { dayKey } from '@/lib/datetime';
import { roleLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Profile, Task } from '@/lib/types';

import { Choice } from '../Choice';
import { DateTimeField } from '../DateTimeField';
import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

const UNASSIGNED = '';

export function AssignPanel({ task, onSaved }: { task: Task; onSaved: () => void }) {
  const { t } = useI18n();
  const [team, setTeam] = useState<Profile[]>([]);
  const [assignee, setAssignee] = useState(task.assignee_id ?? UNASSIGNED);
  // due_date — просто день ("ГГГГ-ММ-ДД"), без часового пояса.
  const [dueDate, setDueDate] = useState<Date | null>(() => {
    if (!task.due_date) return null;
    const [y, m, d] = task.due_date.split('-').map(Number);
    return new Date(y, m - 1, d);
  });
  const [brief, setBrief] = useState(task.brief ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      // Назначить можно сотрудника с ролью (не клиента и не ожидающего).
      .not('role', 'in', '(client,pending)')
      .order('full_name')
      .then(({ data }) => setTeam((data as Profile[] | null) ?? []));
  }, []);

  const save = async () => {
    setError(null);
    setSaving(true);
    const { error } = await supabase.rpc('assign_task', {
      p_task_id: task.id,
      p_assignee_id: assignee || null,
      p_due_date: dueDate ? dayKey(dueDate) : null,
      p_brief: brief,
    });
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('task.assignTitle')}</Text>
      <Choice
        value={assignee}
        onChange={setAssignee}
        options={[
          { value: UNASSIGNED, label: t('task.unassigned') },
          ...team.map((member) => ({
            value: member.id,
            label: member.full_name || member.email || member.id.slice(0, 8),
            hint: roleLabel(t, member),
          })),
        ]}
      />
      <DateTimeField label={t('task.dueDate')} mode="date" value={dueDate} onChange={setDueDate} />
      <Field label={t('task.brief')} multiline value={brief} onChangeText={setBrief} />
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={save} loading={saving} />
    </Card>
  );
}
