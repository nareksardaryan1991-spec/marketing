// Достижения клиента: недели подряд с публикациями и сколько всего вышло.
// Неделя — с понедельника по Еревану (UTC+4), как у идей задач.

const GOALS = [5, 10, 25, 50, 100, 250, 500, 1000];

export function yerevanWeek(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function previousWeek(week: string): string {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function achievements(publishedAt: string[], now = new Date()) {
  const weeks = new Set(publishedAt.map(yerevanWeek));
  // Серия не обрывается, пока идёт текущая неделя: считаем от неё или от прошлой.
  let week = yerevanWeek(now.toISOString());
  if (!weeks.has(week)) week = previousWeek(week);
  let streak = 0;
  while (weeks.has(week)) {
    streak++;
    week = previousWeek(week);
  }
  const total = publishedAt.length;
  const goal = GOALS.find((g) => g > total) ?? null;
  return { total, streak, goal, left: goal ? goal - total : 0 };
}
