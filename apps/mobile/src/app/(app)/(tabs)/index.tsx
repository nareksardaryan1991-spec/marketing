import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { AssistantCard } from '@/components/AssistantCard';
import { BusinessCard } from '@/components/BusinessCard';
import { IdeasCard } from '@/components/client/IdeasCard';
import { TeamCard } from '@/components/client/TeamCard';
import { WelcomeKitCard } from '@/components/client/WelcomeKitCard';
import { NavList, NavRow } from '@/components/NavList';
import { ProfileHeader } from '@/components/ProfileHeader';
import { ReviewInbox } from '@/components/ReviewInbox';
import { Screen } from '@/components/Screen';
import { TaskSections, type TaskSection } from '@/components/TaskSections';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { isEmployeeRole, isManagerRole } from '@/lib/roles';
import type { Business, Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Главная: только то, что нужно сделать сейчас. Разделы — во вкладках нижнего меню,
// редкие экраны (панель, команда, услуги, календарь, отчёты) — во вкладке «Профиль».
export default function HomeScreen() {
  const { t } = useI18n();
  const { profile, business } = useAuth();

  if (!profile) return null;

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.title')}
        onPress={() => router.navigate('/profile')}>
        <ProfileHeader profile={profile} subtitle={t(`roles.${profile.role}`)} />
      </Pressable>

      {profile.role === 'client' && business && <ClientHome business={business} />}
      {isEmployeeRole(profile.role) && <StaffHome profile={profile} />}
    </Screen>
  );
}

function ClientHome({ business }: { business: Business }) {
  const { t } = useI18n();
  return (
    <>
      <WelcomeKitCard />
      <ReviewInbox />
      <TeamCard />
      <IdeasCard />
      <BusinessCard business={business} />
      <Button title={t('order.newOrder')} onPress={() => router.push('/new-order')} />
    </>
  );
}

function StaffHome({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const manager = isManagerRole(profile.role);
  const sections: TaskSection[] = [
    ...(manager
      ? [
          { key: 'review', title: t('home.toReview'), statuses: ['internal_review'] },
          { key: 'publish', title: t('home.publishNow'), statuses: ['publishing'] },
          { key: 'changes', title: t('home.clientChanges'), statuses: ['changes_requested'] },
          { key: 'new', title: t('home.unassigned'), statuses: ['new'] },
        ]
      : profile.role === 'smm'
        ? [{ key: 'publish', title: t('home.publishNow'), statuses: ['publishing'] }]
        : []),
    {
      key: 'mine',
      title: t('home.tasksTitle'),
      statuses: ['assigned', 'in_progress', 'changes_requested', 'internal_review'],
      assigneeId: profile.id,
    },
  ] as TaskSection[];

  return (
    <>
      {manager && (
        <NavList>
          <NavRow icon="speedometer-outline" title={t('dashboard.title')} href="/dashboard" />
          <NavRow icon="cube-outline" title={t('tabs.ordersAll')} href="/orders" />
        </NavList>
      )}
      <AssistantCard />
      <TaskSections sections={sections} />
    </>
  );
}
