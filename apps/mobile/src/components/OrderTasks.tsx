import { Link, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Deliverable, Localized, PublishingMode, Task } from '@/lib/types';

import { ClientDecision } from './ClientDecision';
import { FileList } from './task/FileList';
import { PublishPanel } from './task/PublishPanel';
import { TaskStatusBadge } from './TaskStatusBadge';
import { colors } from './theme';
import { Card } from './ui';

type Row = Task & { services: { name: Localized } | null; deliverables: Deliverable[] };

// Задачи заказа. Клиент видит здесь материалы на согласовании, команда — ссылки на задачи.
export function OrderTasks({
  orderId,
  isClient,
  publishing,
}: {
  orderId: string;
  isClient: boolean;
  publishing: PublishingMode;
}) {
  const { t, language } = useI18n();
  const [tasks, setTasks] = useState<Row[]>([]);

  const load = useCallback(() => {
    supabase
      .from('tasks')
      .select('*, services(name), deliverables(*)')
      .eq('order_id', orderId)
      .order('service_id')
      .order('number')
      .then(({ data }) => setTasks((data as Row[] | null) ?? []));
  }, [orderId]);

  useFocusEffect(load);

  if (tasks.length === 0) return null;

  const waiting = tasks.filter((task) => task.status === 'client_review');
  // В режиме «клиент публикует сам» клиент забирает одобренные файлы и отмечает публикацию.
  const toPublish =
    isClient && publishing === 'client'
      ? tasks.filter((task) => task.status === 'approved' || task.status === 'publishing')
      : [];
  const latestOf = (task: Row) => [...task.deliverables].sort((a, b) => b.version - a.version)[0];
  const title = (task: Row) => taskTitle(task, task.services?.name, language);

  return (
    <>
      {isClient &&
        waiting.map((task) => {
          const latest = latestOf(task);
          return (
            <Card key={task.id}>
              <View style={styles.row}>
                <Text style={styles.name}>{title(task)}</Text>
                <TaskStatusBadge status={task.status} />
              </View>
              {latest?.caption ? (
                <Text selectable style={styles.caption}>
                  {latest.caption}
                </Text>
              ) : null}
              {latest && <FileList paths={latest.files} />}
              <ClientDecision taskId={task.id} onDone={load} />
            </Card>
          );
        })}

      {toPublish.map((task) => {
        const latest = latestOf(task);
        return (
          <Card key={task.id}>
            <View style={styles.row}>
              <Text style={styles.name}>{title(task)}</Text>
              <TaskStatusBadge status={task.status} />
            </View>
            {latest?.caption ? (
              <Text selectable style={styles.caption}>
                {latest.caption}
              </Text>
            ) : null}
            {latest && <FileList paths={latest.files} />}
            <PublishPanel task={task} onChanged={load} />
          </Card>
        );
      })}

      <Card>
        <Text style={styles.title}>{t('order.tasks')}</Text>
        {tasks.map((task) => {
          const content = (
            <>
              <View style={styles.row}>
                <Text style={styles.text}>{title(task)}</Text>
                <TaskStatusBadge status={task.status} />
              </View>
              {isClient && task.published_url ? (
                <Pressable onPress={() => WebBrowser.openBrowserAsync(task.published_url!)}>
                  <Text style={styles.link} numberOfLines={1}>
                    {task.published_url}
                  </Text>
                </Pressable>
              ) : null}
            </>
          );
          return isClient ? (
            <View key={task.id} style={styles.item}>
              {content}
            </View>
          ) : (
            <Link key={task.id} href={`/tasks/${task.id}`} asChild>
              <Pressable style={styles.item}>{content}</Pressable>
            </Link>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  item: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, flex: 1 },
  text: { fontSize: 15, color: colors.text, flex: 1 },
  caption: { fontSize: 15, color: colors.text },
  link: { fontSize: 14, color: colors.primary, marginTop: 4 },
});
