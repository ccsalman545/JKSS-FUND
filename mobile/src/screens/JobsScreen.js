// src/screens/JobsScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, Modal, TextInput, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Button, Subtitle, Input } from '../components/ui';
import { api } from '../api';
import { formatINR, formatDate } from '../utils/format';
import { palette } from '../theme';
import { STUDENT_SHARE_PCT } from '../config';

export default function JobsScreen() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [jobs, setJobs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const d = await api.dashboard();
    setJobs(d.jobs);
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const add = async () => {
    setErr(''); setSaving(true);
    try {
      await api.addJob(name.trim(), parseFloat(amount), date);
      setShowAdd(false); setName(''); setAmount('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = (j) => {
    Alert.alert('Delete job', `Delete "${j.name}"? Student balances will be reversed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await api.deleteJob(j.id); await load(); } },
    ]);
  };

  const perStudent = (j) => (j.student_share / Math.max(1, jobs.length) || 0);

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: theme.text }]}>Jobs</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: palette.accent }]} onPress={() => setShowAdd(true)}>
          <Text style={styles.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} style={{ flex: 1 }}>
        {jobs.map((j) => (
          <Card key={j.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.text }]}>{j.name}</Text>
                <Subtitle>{formatDate(j.date)}</Subtitle>
                <Text style={[styles.calc, { color: theme.textMuted }]}>
                  {formatINR(j.committee_share)} committee · {STUDENT_SHARE_PCT}% to students
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.amt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
                <TouchableOpacity onPress={() => remove(j)}><Text style={{ color: palette.danger, fontSize: 12 }}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          </Card>
        ))}
        {jobs.length === 0 ? <Text style={[styles.empty, { color: theme.textMuted }]}>No jobs yet.</Text> : null}
      </ScrollView>

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Job</Text>
            <Input placeholder="Job name (e.g. Hostel Cleaning)" value={name} onChangeText={setName} />
            <Input placeholder="Total amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
            <Input placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            {err ? <Text style={{ color: palette.danger, marginBottom: 8 }}>{err}</Text> : null}
            <Button label={saving ? 'Adding…' : 'Add Job'} loading={saving} onPress={add} variant="accent" />
            <Button label="Cancel" variant="outline" onPress={() => setShowAdd(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '800' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  addText: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '700' },
  calc: { fontSize: 11, marginTop: 4 },
  amt: { fontSize: 16, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 24 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
});
