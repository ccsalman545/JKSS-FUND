// src/screens/JobsScreen.js
// Admin: jobs — list with 10/90 split breakdown, add (sheet with live split preview).
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, Header, Card, Button, Input, IconButton,
  Sheet, ConfirmSheet, EmptyState,
} from '../components/ui';
import { api } from '../api';
import { formatINR, formatDate, asDate, sameMonth } from '../utils/format';
import { palette } from '../theme';
import { COMMITTEE_SHARE_PCT, STUDENT_SHARE_PCT } from '../config';

export default function JobsScreen() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [jobs, setJobs] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(asDate().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    const d = await api.dashboard();
    setJobs(d.jobs);
    setStudentCount(d.students.length);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const add = async () => {
    setErr('');
    setSaving(true);
    try {
      await api.addJob(name.trim(), parseFloat(amount), date);
      setShowAdd(false);
      setName('');
      setAmount('');
      await load();
    } catch (e) {
      setErr(e.message?.replace('Firebase: ', '') || 'Could not add job');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    await api.deleteJob(toDelete.id);
    setToDelete(null);
    await load();
  };

  const amt = parseFloat(amount) || 0;
  const previewCommittee = +(amt * (COMMITTEE_SHARE_PCT / 100)).toFixed(2);
  const previewStudent = +(amt * (STUDENT_SHARE_PCT / 100)).toFixed(2);
  const previewPerStudent = studentCount > 0 ? +(previewStudent / studentCount).toFixed(2) : 0;

  const totalCollected = jobs.reduce((s, j) => s + Number(j.amount || 0), 0);
  const monthCollected = jobs
    .filter((j) => sameMonth(j.date || j.createdAt))
    .reduce((s, j) => s + Number(j.amount || 0), 0);

  return (
    <Screen>
      <Header
        title="Jobs"
        subtitle={`${jobs.length} total · ${formatINR(totalCollected)} collected`}
        right={
          <Button label="Add job" icon="add" size="sm" variant="accent" onPress={() => { setErr(''); setShowAdd(true); }} style={{ marginLeft: 12 }} />
        }
      />

      <Card noPad style={styles.summary}>
        <View style={styles.summaryCol}>
          <Text style={[styles.summaryValue, { color: theme.text }]}>{formatINR(totalCollected)}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>All time</Text>
        </View>
        <View style={[styles.summaryCol, { borderLeftWidth: 1, borderColor: theme.border }]}>
          <Text style={[styles.summaryValue, { color: palette.success }]}>{formatINR(monthCollected)}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>This month</Text>
        </View>
        <View style={[styles.summaryCol, { borderLeftWidth: 1, borderColor: theme.border }]}>
          <Text style={[styles.summaryValue, { color: palette.primary }]}>{studentCount}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Students sharing</Text>
        </View>
      </Card>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        {jobs.length === 0 ? (
          <EmptyState
            icon="briefcase-outline"
            title="No jobs yet"
            subtitle="Add a job and the 10% / 90% split is applied automatically to every student."
          />
        ) : (
          <Card noPad>
            {jobs.map((j, i) => (
              <View key={j.id} style={[styles.jobCard, i < jobs.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}>
                <View style={styles.jobTop}>
                  <View style={[styles.jobIcon, { backgroundColor: palette.primarySoft }]}>
                    <Ionicons name="briefcase-outline" size={16} color={palette.primary} />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={[styles.jobName, { color: theme.text }]} numberOfLines={1}>{j.name}</Text>
                    <Text style={[styles.jobDate, { color: theme.textFaint }]}>{formatDate(j.date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.jobAmt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
                    <IconButton
                      icon="trash-outline"
                      tint={palette.danger}
                      size={30}
                      style={{ marginTop: 4 }}
                      onPress={() => setToDelete(j)}
                    />
                  </View>
                </View>

                <View style={styles.splitRow}>
                  <View style={styles.splitSegments}>
                    <View style={[styles.splitSeg, { backgroundColor: palette.accent, width: '10%' }]} />
                    <View style={[styles.splitSeg, { backgroundColor: palette.primary, width: '90%' }]} />
                  </View>
                </View>
                <View style={styles.splitValues}>
                  <Text style={[styles.splitVal, { color: theme.textMuted }]}>
                    <Text style={{ color: palette.accent, fontWeight: '800' }}>● </Text>
                    Committee {formatINR(j.committeeShare)}
                  </Text>
                  <Text style={[styles.splitVal, { color: theme.textMuted }]}>
                    <Text style={{ color: palette.primary, fontWeight: '800' }}>● </Text>
                    Students {formatINR(j.studentShare)}
                    {j.perStudent ? <Text style={{ color: theme.textFaint }}> · {formatINR(j.perStudent)}/head</Text> : null}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      <Sheet visible={showAdd} onClose={() => setShowAdd(false)} title="Add job">
        <Input
          icon="briefcase-outline"
          label="Job name"
          placeholder="e.g. Hostel cleaning — week 4"
          value={name}
          onChangeText={(t) => { setName(t); setErr(''); }}
        />
        <Input
          icon="cash-outline"
          label="Total amount"
          prefix="₹"
          placeholder="0"
          keyboardType="numeric"
          value={amount}
          onChangeText={(t) => { setAmount(t); setErr(''); }}
        />
        <Input
          icon="calendar-outline"
          label="Date"
          placeholder="YYYY-MM-DD"
          value={date}
          onChangeText={setDate}
          error={err || undefined}
          style={{ marginBottom: 10 }}
        />

        {amt > 0 ? (
          <Card noPad style={[styles.preview, { backgroundColor: theme.mode === 'dark' ? 'rgba(99,102,241,0.1)' : palette.primarySoft }]}>
            <Text style={[styles.previewTitle, { color: theme.mode === 'dark' ? '#A5B4FC' : palette.primaryDark }]}>Split preview</Text>
            <View style={styles.previewRow}>
              <View>
                <Text style={[styles.previewBig, { color: theme.mode === 'dark' ? '#FBBF24' : '#B45309' }]}>{formatINR(previewCommittee)}</Text>
                <Text style={[styles.previewSmall, { color: theme.textMuted }]}>Committee ({COMMITTEE_SHARE_PCT}%)</Text>
              </View>
              <View style={{ flex: 1 }} />
              <View style={{ textAlign: 'right' }}>
                <Text style={[styles.previewBig, { color: theme.mode === 'dark' ? '#A5B4FC' : palette.primaryDark }]}>{formatINR(previewStudent)}</Text>
                <Text style={[styles.previewSmall, { color: theme.textMuted }]}>
                  Students ({STUDENT_SHARE_PCT}%) · {studentCount > 0 ? formatINR(previewPerStudent) + ' each' : 'add students first'}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        <Button
          label={saving ? 'Adding…' : 'Add job'}
          loading={saving}
          onPress={add}
          size="lg"
          variant="accent"
          icon="checkmark-circle-outline"
          style={{ marginTop: 8 }}
        />
      </Sheet>

      <ConfirmSheet
        visible={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete job?"
        message={`"${toDelete?.name || ''}" will be removed and every student's share (${toDelete ? formatINR(toDelete.perStudent || 0) : ''} each) will be reversed.`}
        confirmLabel="Delete job"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', marginBottom: 14, padding: 0, overflow: 'hidden' },
  summaryCol: { flex: 1, paddingVertical: 14, paddingHorizontal: 12 },
  summaryValue: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.3 },
  summaryLabel: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  jobCard: { padding: 14 },
  jobTop: { flexDirection: 'row', alignItems: 'center' },
  jobIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  jobName: { fontSize: 14.5, fontWeight: '700' },
  jobDate: { fontSize: 11.5, marginTop: 2 },
  jobAmt: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.3 },
  splitRow: { marginTop: 12 },
  splitSegments: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden',
  },
  splitSeg: { height: 8 },
  splitValues: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  splitVal: { fontSize: 11.5, fontWeight: '600' },
  preview: { borderRadius: 16, padding: 14, marginTop: 2 },
  previewTitle: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-end' },
  previewBig: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  previewSmall: { fontSize: 11, fontWeight: '600', marginTop: 2 },
});
