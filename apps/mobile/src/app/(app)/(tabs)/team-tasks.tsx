import { TaskBoard } from '@/components/TaskBoard';

// Задачи команды: поручения людям от владельца и менеджеров (не AI-агентам).
export default function TeamTasksScreen() {
  return <TaskBoard kind="team" />;
}
