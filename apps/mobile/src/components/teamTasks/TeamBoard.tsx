import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { useI18n } from '@/i18n';
import { TEAM_STAGES, teamMoves, teamStage, type TeamMove, type TeamStage, type TeamTaskRow } from '@/lib/teamTasks';
import type { UserRole } from '@/lib/types';

import { colors, tints } from '../theme';
import { TeamTaskItem, type Person } from './TeamTaskItem';

// Готовых на доске показываем только последние.
const DONE_ON_BOARD = 20;
const WIDE = 900;
// У края доски во время перетаскивания она сама листается вбок.
const EDGE = 48;
const SCROLL_STEP = 24;

type Drag = { task: TeamTaskRow; x: number; y: number; over: TeamStage | null };

// Kanban задач команды. Карточку берут за ручку ⠿ и переносят в другую колонку; нажатие на ручку без
// перетаскивания открывает меню «Переместить в…» (удобнее на телефоне). Колонки, куда переместить нельзя,
// во время перетаскивания бледнеют. Что можно — teamMoves (те же правила, что в базе).
export function TeamBoard({
  tasks,
  byId,
  user,
  onMove,
}: {
  tasks: TeamTaskRow[];
  byId: Map<string, Person>;
  user: { id: string; role: UserRole } | null;
  onMove: (task: TeamTaskRow, to: TeamStage, move: TeamMove) => void;
}) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  // Колонка на телефоне — почти во всю ширину, соседняя выглядывает: видно, что листается вбок.
  const columnWidth = wide ? 280 : Math.min(320, width - 48);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Где доска на экране — от этого считается положение карточки «в руке».
  const [origin, setOrigin] = useState({ left: 0, top: 0 });
  const boardRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Положение доски на экране, прокрутка и колонки (x в прокручиваемой области) — чтобы понять, над какой колонкой палец.
  const geometry = useRef({ left: 0, top: 0, width: 0, scrollX: 0, maxScroll: 0, columns: {} as Record<string, { x: number; w: number }> });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Карточка в руке — в ref: отпускание может прийти раньше, чем React перерисует доску.
  const held = useRef<TeamTaskRow | null>(null);

  const stageAt = (pageX: number): TeamStage | null => {
    const g = geometry.current;
    const x = pageX - g.left + g.scrollX;
    return TEAM_STAGES.find((s) => {
      const c = g.columns[s.key];
      return c && x >= c.x && x <= c.x + c.w;
    })?.key ?? null;
  };

  // Обработчики жестов создаются один раз на карточку — свежие функции берём отсюда.
  const handlers = useRef<Gesture>({ start: () => {}, move: () => {}, end: () => {}, cancel: () => {} });
  useLayoutEffect(() => {
    handlers.current = {
    start: (task, x, y) => {
      boardRef.current?.measureInWindow((left, top, w) => {
        Object.assign(geometry.current, { left, top, width: w });
        setOrigin({ left, top });
      });
      pointer.current = { x, y };
      held.current = task;
      setDrag({ task, x, y, over: null });
    },
    move: (x, y) => {
      pointer.current = { x, y };
      setDrag((d) => (d ? { ...d, x, y, over: stageAt(x) } : d));
    },
    end: (x, _y, tap) => {
      const task = held.current;
      held.current = null;
      pointer.current = null;
      setDrag(null);
      if (!task) return;
      if (tap) {
        setMenuFor((open) => (open === task.id ? null : task.id));
        return;
      }
      setMenuFor(null);
      const to = stageAt(x);
      const move = to ? teamMoves(task, user)[to] : undefined;
      if (to && move) onMove(task, to, move);
    },
    cancel: () => {
      held.current = null;
      pointer.current = null;
      setDrag(null);
    },
    };
  });

  // Стабильные обёртки для ручек: сам жест не пересоздаётся при каждой перерисовке доски.
  const gesture = useMemo<Gesture>(
    () => ({
      start: (task, x, y) => handlers.current.start(task, x, y),
      move: (x, y) => handlers.current.move(x, y),
      end: (x, y, tap) => handlers.current.end(x, y, tap),
      cancel: () => handlers.current.cancel(),
    }),
    [],
  );

  // Автопрокрутка вбок, пока карточку держат у края доски.
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    // В браузере во время перетаскивания мышью текст на странице не выделяется.
    if (Platform.OS === 'web') document.body.style.userSelect = 'none';
    const timer = setInterval(() => {
      const p = pointer.current;
      const g = geometry.current;
      if (!p || !g.width) return;
      const dir = p.x < g.left + EDGE ? -1 : p.x > g.left + g.width - EDGE ? 1 : 0;
      if (!dir) return;
      const next = Math.max(0, Math.min(g.maxScroll, g.scrollX + dir * SCROLL_STEP));
      if (next === g.scrollX) return;
      g.scrollX = next;
      scrollRef.current?.scrollTo({ x: next, animated: false });
      setDrag((d) => (d ? { ...d, over: stageAt(p.x) } : d));
    }, 40);
    return () => {
      clearInterval(timer);
      if (Platform.OS === 'web') document.body.style.userSelect = '';
    };
  }, [dragging]);

  const allowed = drag ? teamMoves(drag.task, user) : {};
  const moveLabel = (stage: TeamStage, move: TeamMove) =>
    move === 'status' ? t(`teamTasks.status.${stage}`) : t(`teamTasks.board.${move}`);

  return (
    <View ref={boardRef} style={styles.board}>
      <ScrollView
        ref={scrollRef}
        horizontal
        // Пока тащат карточку, доску листает автопрокрутка, а не палец.
        scrollEnabled={!drag}
        snapToInterval={wide ? undefined : columnWidth + 12}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={(e) => {
          geometry.current.scrollX = e.nativeEvent.contentOffset.x;
        }}
        onLayout={(e) => {
          geometry.current.width = e.nativeEvent.layout.width;
        }}
        onContentSizeChange={(w) => {
          geometry.current.maxScroll = Math.max(0, w - geometry.current.width);
        }}
        contentContainerStyle={styles.columns}>
        {TEAM_STAGES.map((stage) => {
          const all = tasks.filter((task) => teamStage(task.status) === stage.key);
          const cards = stage.key === 'done' ? all.slice(0, DONE_ON_BOARD) : all;
          const target = drag ? allowed[stage.key] : undefined;
          const home = drag && teamStage(drag.task.status) === stage.key;
          return (
            <View
              key={stage.key}
              onLayout={(e: LayoutChangeEvent) => {
                geometry.current.columns[stage.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
              }}
              style={[
                styles.column,
                { width: columnWidth },
                drag && !target && !home && styles.columnDisabled,
                target && styles.columnTarget,
                target && drag?.over === stage.key && styles.columnOver,
              ]}>
              <View style={styles.columnHeader}>
                <View style={[styles.dot, { backgroundColor: stage.color }]} />
                <Text style={styles.columnTitle}>{t(`teamTasks.status.${stage.key}`)}</Text>
                <Text style={styles.count}>{all.length}</Text>
              </View>
              <ScrollView contentContainerStyle={styles.cards} scrollEnabled={!drag}>
                {cards.length === 0 && <Text style={styles.empty}>—</Text>}
                {cards.map((task) => {
                  const moves = Object.entries(teamMoves(task, user)) as [TeamStage, TeamMove][];
                  return (
                    <View key={task.id} style={[drag?.task.id === task.id && styles.lifted]}>
                      <View style={styles.cardRow}>
                        {moves.length > 0 ? (
                          <Handle task={task} gesture={gesture} label={t('teamTasks.board.move')} />
                        ) : (
                          <View style={styles.handleSpace} />
                        )}
                        <View style={styles.flex}>
                          <TeamTaskItem
                            task={task}
                            person={task.assignee_id ? byId.get(task.assignee_id) : undefined}
                            showStatus={false}
                            unassignedLabel={t('board.noAssignee')}
                          />
                        </View>
                      </View>
                      {menuFor === task.id && (
                        <View style={styles.menu}>
                          <Text style={styles.menuTitle}>{t('teamTasks.board.moveTo')}</Text>
                          {TEAM_STAGES.filter((s) => moves.some(([to]) => to === s.key)).map((s) => {
                            const move = moves.find(([to]) => to === s.key)![1];
                            return (
                              <Pressable
                                key={s.key}
                                accessibilityRole="button"
                                onPress={() => {
                                  setMenuFor(null);
                                  onMove(task, s.key, move);
                                }}
                                style={styles.menuItem}>
                                <View style={[styles.dot, { backgroundColor: s.color }]} />
                                <Text style={styles.menuText}>{moveLabel(s.key, move)}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      {/* Карточка «в руке» — следует за пальцем или мышью. */}
      {drag && (
        <View
          pointerEvents="none"
          style={[
            styles.ghost,
            { width: columnWidth - 40, left: drag.x - origin.left - 20, top: drag.y - origin.top - 20 },
          ]}>
          <Text style={styles.ghostText} numberOfLines={2}>
            {drag.task.title}
          </Text>
          {drag.over && (
            <Text style={[styles.ghostHint, !allowed[drag.over] && { color: colors.danger }]}>
              {allowed[drag.over]
                ? `→ ${moveLabel(drag.over, allowed[drag.over]!)}`
                : teamStage(drag.task.status) === drag.over
                  ? ''
                  : t('teamTasks.board.notAllowed')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

type Gesture = {
  start: (task: TeamTaskRow, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number, tap: boolean) => void;
  cancel: () => void;
};

// Ручка карточки: тащить — перенос, нажать — меню «Переместить в…».
function Handle({ task, gesture, label }: { task: TeamTaskRow; gesture: Gesture; label: string }) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Начатое перетаскивание не отдаём прокрутке.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => gesture.start(task, e.nativeEvent.pageX, e.nativeEvent.pageY),
        onPanResponderMove: (_, g) => gesture.move(g.moveX, g.moveY),
        onPanResponderRelease: (_, g) =>
          gesture.end(g.moveX || g.x0, g.moveY || g.y0, Math.abs(g.dx) + Math.abs(g.dy) < 6),
        onPanResponderTerminate: () => gesture.cancel(),
      }),
    [gesture, task],
  );
  return (
    <View {...responder.panHandlers} accessible accessibilityRole="button" accessibilityLabel={label} style={styles.handle}>
      <Text style={styles.handleText}>⠿</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flex: 1 },
  flex: { flex: 1 },
  columns: { gap: 12, padding: 12, flexGrow: 1 },
  column: { borderRadius: 22, padding: 8, gap: 8, borderWidth: 2, borderColor: colors.border },
  columnDisabled: { opacity: 0.45 },
  columnTarget: { borderColor: tints.accent.bg, borderStyle: 'dashed' },
  columnOver: { borderColor: colors.primary, borderStyle: 'solid', backgroundColor: tints.accent.bg },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  count: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  cards: { gap: 8 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  lifted: { opacity: 0.4 },
  handle: { width: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 8, cursor: 'pointer' },
  handleSpace: { width: 24 },
  handleText: { fontSize: 18, color: colors.muted },
  menu: { marginTop: 4, marginLeft: 28, padding: 8, gap: 2, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  menuTitle: { fontSize: 13, color: colors.muted, paddingHorizontal: 6, paddingBottom: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 8 },
  menuText: { fontSize: 15, color: colors.text },
  ghost: {
    position: 'absolute',
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    gap: 4,
  },
  ghostText: { fontSize: 15, fontWeight: '600', color: colors.text },
  ghostHint: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
