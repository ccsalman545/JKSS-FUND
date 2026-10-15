// src/screens/AdminDashboard.js
// Admin home: hero KPI, stat grid, quick actions, split explainer, recent jobs.
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, Header, Card, GradientCard, StatTile, SectionHeader, Avatar, EmptyState,
} from '../components/ui';
import { api } from '../api';
import { formatINR, formatDate, asDate } from '../utils/format';
import { palette } from '../theme';

export default function AdminDashboard({ navigation }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [data, setData] = useState(null);

  // Real-time dashboard: updates instantly when students/jobs change.
  useEffect(() => {
    const unsub = api.subscribeDashboard(setData);
    return unsub;
  }, []);

  if (!data) return <Screen />;

  const { stats, committeeBalance, jobs } = data;
  const today = asDate().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Screen>
      <Header
        title="Dashboard"
        subtitle={today}
        right={<Avatar name={user?.full_name || 'Admin'} size={42} style={{ marginLeft: 12 }} />}
      />

      <GradientCard style={styles.hero}>
        <Text style={styles.heroLabel}>Distributed to students</Text>
        <Text style={styles.heroValue}>{formatINR(stats.totalDistributed)}</Text>
        <View style={styles.heroChips}>
          <View style={styles.heroChip}>
            <Ionicons name="people" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.heroChipText}>{stats.totalStudents} students</Text>
          </View>
          <View style={styles.heroChip}>
            <Ionicons name="briefcase" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.heroChipText}>{stats.totalJobs} jobs</Text>
          </View>
          <View style={styles.heroChip}>
            <Ionicons name="shield-checkmark" size={13} color="#FCD34D" />
            <Text style={styles.heroChipText}>{formatINR(committeeBalance)} committee</Text>
          </View>
        </View>
      </GradientCard>

      <View style={styles.statsGrid}>
        <StatTile icon="people-outline" label="Students" value={String(stats.totalStudents)} tint={palette.info} style={styles.tile} />
        <StatTile icon="briefcase-outline" label="Jobs added" value={String(stats.totalJobs)} tint={palette.primary} style={styles.tile} />
        <StatTile icon="wallet-outline" label="Total collected" value={formatINR(stats.totalJobsAmount)} tint={palette.success} style={styles.tile} />
        <StatTile icon="safe" label="Committee fund" value={formatINR(committeeBalance)} tint={palette.accent} style={styles.tile} />
      </View>

      <View style={styles.quickRow}>
        <QuickTile
          icon="add-circle"
          title="Add Job"
          subtitle="Split 10 / 90 instantly"
          colors={theme.gradientAccent}
          onPress={() => navigation.navigate('Jobs')}
          style={{ flex: 1 }}
        />
        <QuickTile
          icon="person-add"
          title="Manage Students"
          subtitle={`${stats.totalStudents} active`}
          colors={theme.gradient}
          onPress={() => navigation.navigate('Students')}
          style={{ flex: 1, marginLeft: 12 }}
        />
      </View>

      <SectionHeader title="Recent jobs" action="See all" onAction={() => navigation.navigate('Jobs')} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {jobs.length === 0 ? (
          <EmptyState
            icon="briefcase-outline"
            title="No jobs yet"
            subtitle="Add your first job — the 10% / 90% split happens automatically."
          />
        ) : (
          <Card noPad>
            {jobs.slice(0, 4).map((j, i) => {
              const shown = Math.min(jobs.length, 4);
              return (
                <View key={j.id} style={[styles.jobInner, i < shown - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}>
                  <View style={[styles.jobIcon, { backgroundColor: palette.primarySoft }]}>
                    <Ionicons name="briefcase-outline" size={17} color={palette.primary} />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={[styles.jobName, { color: theme.text }]} numberOfLines={1}>{j.name}</Text>
                    <Text style={[styles.jobMeta, { color: theme.textFaint }]}>
                      {formatDate(j.date)} · {formatINR(j.studentShare)} → students
                    </Text>
                  </View>
                  <Text style={[styles.jobAmt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function QuickTile({ icon, title, subtitle, colors, onPress, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 22,
        padding: 16,
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1,
        shadowColor: 'rgba(15, 23, 42, 0.25)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 14,
        elevation: 6,
        ...style,
      })}
    >
      <TileInner icon={icon} title={title} subtitle={subtitle} colors={colors} />
    </Pressable>
  );
}

// Inner content rendered inside the gradient (kept as a child so LinearGradient styles apply).
function TileInner({ icon, title, subtitle, colors }) {
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 16, overflow: 'hidden' }}>
      <View style={styles.quickIconWrap}>
        <Ionicons name={icon} size={19} color="#fff" />
      </View>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickSub}>{subtitle}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 22, marginBottom: 14 },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  heroValue: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -1, marginVertical: 4 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginRight: 8, marginBottom: 6,
  },
  heroChipText: { color: '#fff', fontSize: 11.5, fontWeight: '700', marginLeft: 5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 14 },
  tile: { width: '48.5%', marginBottom: 12 },
  quickRow: { flexDirection: 'row', marginBottom: 4 },
  quickIconWrap: {
    width: 38, height: 38, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  quickTitle: { color: '#fff', fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },
  quickSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  jobInner: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  jobIcon: {
    width: 38, height: 38, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  jobName: { fontSize: 14.5, fontWeight: '700' },
  jobMeta: { fontSize: 11.5, marginTop: 3 },
  jobAmt: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
});
