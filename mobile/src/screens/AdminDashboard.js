// src/screens/AdminDashboard.js
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, StatCard, Subtitle } from '../components/ui';
import { api } from '../api';
import { formatINR, formatDate } from '../utils/format';
import { palette } from '../theme';
import { COMMITTEE_SHARE_PCT, STUDENT_SHARE_PCT } from '../config';

export default function AdminDashboard({ navigation }) {
  const { theme } = useTheme();
  const [data, setData] = useState(null);

  // Real-time dashboard: updates instantly when students/jobs change.
  useEffect(() => {
    const unsub = api.subscribeDashboard(setData);
    return unsub;
  }, []);

  if (!data) return <Screen />;

  return (
    <Screen>
      <Text style={[styles.heading, { color: theme.text }]}>Admin Dashboard</Text>
      <View style={styles.statsRow}>
        <StatCard label="Students" value={data.stats.totalStudents} />
        <StatCard label="Jobs Added" value={data.stats.totalJobs} color={palette.info} />
      </View>
      <View style={styles.statsRow}>
        <StatCard label="Distributed" value={formatINR(data.stats.totalDistributed)} color={palette.success} />
        <StatCard label="Committee Fund" value={formatINR(data.committeeBalance)} color={palette.accent} />
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity style={[styles.quick, { backgroundColor: palette.primary }]} onPress={() => navigation.navigate('Students')}>
          <Text style={styles.quickText}>+ Add Student</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quick, { backgroundColor: palette.accent }]} onPress={() => navigation.navigate('Jobs')}>
          <Text style={styles.quickText}>+ Add Job</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.section, { color: theme.text }]}>How funds split</Text>
      <Card>
        <Text style={[styles.split, { color: theme.text }]}>{COMMITTEE_SHARE_PCT}% → Committee Fund</Text>
        <Text style={[styles.split, { color: theme.text }]}>{STUDENT_SHARE_PCT}% → Split equally among students</Text>
      </Card>

      <Text style={[styles.section, { color: theme.text }]}>Recent Jobs</Text>
      <ScrollView style={{ flex: 1 }}>
        {data.jobs.length === 0 ? <Text style={[styles.empty, { color: theme.textMuted }]}>No jobs yet. Tap "Add Job".</Text> : null}
        {data.jobs.map((j) => (
          <Card key={j.id}>
            <View style={styles.jobRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.jobName, { color: theme.text }]}>{j.name}</Text>
                <Subtitle>{formatDate(j.date)}</Subtitle>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.jobAmt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
                <Text style={[styles.jobSplit, { color: theme.textMuted }]}>₹{formatINR(j.studentShare)} → students</Text>
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  quick: { width: '48%', padding: 16, borderRadius: 14, alignItems: 'center' },
  quickText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 4 },
  split: { fontSize: 14, marginBottom: 4 },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between' },
  jobName: { fontSize: 15, fontWeight: '700' },
  jobAmt: { fontSize: 16, fontWeight: '800' },
  jobSplit: { fontSize: 11, marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 24 },
});
