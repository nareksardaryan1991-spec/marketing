import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssistantCard } from '@/components/AssistantCard';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { OrdersList } from '@/components/OrdersList';
import { ChatsButton } from '@/components/ChatsButton';
import { ProfileHeader } from '@/components/ProfileHeader';
import { ReviewInbox } from '@/components/ReviewInbox';
import { TasksList } from '@/components/TasksList';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Business } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { isEmployeeRole, isManagerRole } from '@/lib/roles';

export default function HomeScreen() {
  const { t } = useI18n();
  const { profile, business, signOut } = useAuth();

  if (!profile) return null;

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.push('/profile')}>
        <ProfileHeader profile={profile} subtitle={t(`roles.${profile.role}`)}>
          <Text style={styles.link}>{t('profile.title')} →</Text>
        </ProfileHeader>
      </Pressable>

      {profile.role !== 'pending' && <ChatsButton />}
      {isManagerRole(profile.role) && (
        <Button title={`📊 ${t('dashboard.title')}`} onPress={() => router.push('/dashboard')} />
      )}
      {profile.role !== 'client' && (
        <Button
          title={`🗂 ${t('board.title')}`}
          variant="ghost"
          onPress={() => router.push('/board')}
        />
      )}
      {isEmployeeRole(profile.role) && (
        <Button title={`🤖 ${t('agents.title')}`} onPress={() => router.push('/agents')} />
      )}
      {isEmployeeRole(profile.role) && <AssistantCard />}
      {profile.role === 'client' && business && <ClientHome business={business} />}
      {isManagerRole(profile.role) && (
        <>
          <TasksList
            title={t('home.toReview')}
            statuses={['internal_review']}
            emptyText={t('home.nothingToReview')}
          />
          <TasksList
            title={t('home.publishNow')}
            statuses={['publishing']}
            emptyText={t('home.nothingToPublish')}
          />
          <TasksList
            title={t('home.clientChanges')}
            statuses={['changes_requested']}
            emptyText={t('home.noClientChanges')}
          />
          <TasksList
            title={t('home.unassigned')}
            statuses={['new']}
            emptyText={t('home.noUnassigned')}
          />
          <OrdersList title={t('order.allOrders')} />
          <ClientsList />
          <Button title={t('team.title')} variant="ghost" onPress={() => router.push('/team')} />
          <Button
            title={t('services.title')}
            variant="ghost"
            onPress={() => router.push('/services')}
          />
        </>
      )}
      {profile.role === 'smm' && (
        <TasksList
          title={t('home.publishNow')}
          statuses={['publishing']}
          emptyText={t('home.nothingToPublish')}
        />
      )}
      {profile.role !== 'client' && (
        <TasksList
          title={t('home.tasksTitle')}
          assigneeId={profile.id}
          statuses={['assigned', 'in_progress', 'changes_requested', 'internal_review']}
          emptyText={t('home.noTasks')}
        />
      )}

      <View style={styles.footer}>
        <Button
          title={t('calendar.title')}
          variant="ghost"
          onPress={() => router.push('/calendar')}
        />
        <Text style={styles.muted}>{t('common.language')}</Text>
        <LanguageSwitcher />
        <Button title={t('common.signOut')} variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}

function ClientHome({ business }: { business: Business }) {
  const { t } = useI18n();
  return (
    <>
      <Card>
        <Text style={styles.label}>{t('home.yourBusiness')}</Text>
        <Text style={styles.cardTitle}>{business.name}</Text>
        <Text style={styles.muted}>
          {[business.industry, business.city].filter(Boolean).join(' · ')}
        </Text>
      </Card>
      <ReviewInbox />
      <Button title={t('order.newOrder')} onPress={() => router.push('/new-order')} />
      <Button title={t('reports.title')} variant="ghost" onPress={() => router.push('/reports')} />
      <Button title={t('social.title')} variant="ghost" onPress={() => router.push('/social')} />
      <Button
        title={t('business.title')}
        variant="ghost"
        onPress={() => router.push('/business')}
      />
      <OrdersList title={t('order.myOrders')} />
    </>
  );
}

function ClientsList() {
  const { t } = useI18n();
  const [clients, setClients] = useState<Business[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setClients((data as Business[] | null) ?? []);
      });
  }, []);

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('home.clients')}</Text>
      <ErrorText>{error}</ErrorText>
      {clients.length === 0 && !error && <Text style={styles.muted}>{t('home.noClients')}</Text>}
      {clients.map((client) => (
        <Pressable
          key={client.id}
          style={styles.clientRow}
          onPress={() => router.push({ pathname: '/business', params: { id: client.id } })}>
          <Text style={styles.clientName}>{client.name}</Text>
          <Text style={styles.muted}>
            {[client.industry, client.city].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: 15, fontWeight: '600', color: colors.primary, marginTop: 8 },
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  muted: { fontSize: 15, color: colors.muted },
  clientRow: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clientName: { fontSize: 16, fontWeight: '500', color: colors.text },
  footer: { gap: 12, marginTop: 8 },
});
