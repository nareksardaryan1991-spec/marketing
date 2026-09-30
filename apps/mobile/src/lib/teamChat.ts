import type { UserRole } from './types';

export const TEAM_CHAT_ID = '00000000-0000-4000-8000-00000000c0de';

export type Conversation = {
  id: string;
  kind: 'direct' | 'team';
  other_user_id: string | null;
  other_name: string | null;
  other_role: UserRole | null;
  last_message_at: string | null;
  last_body: string | null;
  last_author: string | null;
  unread: number;
};
