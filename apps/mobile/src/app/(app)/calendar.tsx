import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { TaskStatusBadge } from "@/components/TaskStatusBadge";
import { colors } from "@/components/theme";
import { Card, ErrorText } from "@/components/ui";
import { useI18n } from "@/i18n";
import { dayKey } from "@/lib/datetime";
import { taskTitle } from "@/lib/platforms";
import { supabase } from "@/lib/supabase";
import type { Localized, Task } from "@/lib/types";
import { useAuth } from "@/providers/AuthProvider";

type Row = Task & {
  services: { name: Localized } | null;
  businesses: { name: string } | null;
};

const LOCALES = { ru: "ru-RU", hy: "hy-AM", en: "en-US" } as const;

// Только первая буква: «сентябрь 2026 г.» → «Сентябрь 2026 г.» (не «Г.»).
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Неделя начинается с понедельника.
function monthGrid(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

// Контент-календарь: клиент видит свои публикации, команда — все (RLS).
export default function CalendarScreen() {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [tasks, setTasks] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isClient = profile?.role === "client";
  const locale = LOCALES[language];

  useFocusEffect(
    useCallback(() => {
      const from = new Date(month.getFullYear(), month.getMonth(), 1);
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      supabase
        .from("tasks")
        .select("*, services(name), businesses(name)")
        .gte("publish_at", from.toISOString())
        .lt("publish_at", to.toISOString())
        .order("publish_at")
        .then(({ data, error }) => {
          setError(error?.message ?? null);
          setTasks((data as Row[] | null) ?? []);
        });
    }, [month]),
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const task of tasks) {
      const key = dayKey(new Date(task.publish_at!));
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const weekdays = useMemo(
    () =>
      // 2024-01-01 — понедельник.
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(locale, {
          weekday: "short",
        }),
      ),
    [locale],
  );

  const shift = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const today = dayKey(new Date());
  const dayTasks = byDay.get(selected) ?? [];

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => shift(-1)} style={styles.navButton}>
          <Text style={styles.nav}>‹</Text>
        </Pressable>
        <Text style={styles.month}>
          {capitalize(
            month.toLocaleDateString(locale, {
              month: "long",
              year: "numeric",
            }),
          )}
        </Text>
        <Pressable onPress={() => shift(1)} style={styles.navButton}>
          <Text style={styles.nav}>›</Text>
        </Pressable>
      </View>

      <ErrorText>{error}</ErrorText>

      <Card>
        <View style={styles.grid}>
          {weekdays.map((w) => (
            <Text key={w} style={styles.weekday}>
              {w}
            </Text>
          ))}
          {monthGrid(month).map((date, i) => {
            if (!date) return <View key={`empty-${i}`} style={styles.cell} />;
            const key = dayKey(date);
            const count = byDay.get(key)?.length ?? 0;
            const isSelected = key === selected;
            return (
              <Pressable
                key={key}
                onPress={() => setSelected(key)}
                style={[styles.cell, isSelected && styles.cellSelected]}
              >
                <Text
                  style={[
                    styles.day,
                    key === today && styles.today,
                    isSelected && styles.daySelected,
                  ]}
                >
                  {date.getDate()}
                </Text>
                {count > 0 && (
                  <View style={[styles.dot, isSelected && styles.dotSelected]}>
                    <Text
                      style={[
                        styles.dotText,
                        isSelected && styles.dotTextSelected,
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>
          {new Date(`${selected}T12:00:00`).toLocaleDateString(locale, {
            day: "numeric",
            month: "long",
          })}
        </Text>
        {dayTasks.length === 0 && (
          <Text style={styles.muted}>{t("calendar.empty")}</Text>
        )}
        {dayTasks.map((task) => (
          <Pressable
            key={task.id}
            style={styles.item}
            onPress={() =>
              router.push(
                isClient ? `/orders/${task.order_id}` : `/tasks/${task.id}`,
              )
            }
          >
            <Text style={styles.time}>
              {new Date(task.publish_at!).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {taskTitle(task, task.services?.name, language)}
              </Text>
              {!isClient && (
                <Text style={styles.muted}>{task.businesses?.name}</Text>
              )}
            </View>
            <TaskStatusBadge status={task.status} />
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: { padding: 8 },
  nav: { fontSize: 28, color: colors.primary },
  month: { fontSize: 20, fontWeight: "700", color: colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
    paddingBottom: 6,
    textTransform: "capitalize",
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    gap: 2,
  },
  cellSelected: { backgroundColor: colors.primary },
  day: { fontSize: 15, color: colors.text },
  today: { fontWeight: "700", color: colors.primary },
  daySelected: { color: colors.primaryText, fontWeight: "700" },
  dot: {
    minWidth: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#E0E7FF",
    alignItems: "center",
  },
  dotSelected: { backgroundColor: colors.primaryText },
  dotText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  dotTextSelected: { color: colors.primary },
  cardTitle: { fontSize: 17, fontWeight: "600", color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  time: { fontSize: 15, fontWeight: "600", color: colors.text, minWidth: 48 },
  name: { fontSize: 16, fontWeight: "500", color: colors.text },
});
