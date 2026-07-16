// src/screens/StudentsScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, Modal, TextInput, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Button, Subtitle, Input } from '../components/ui';
import { api } from '../api';
import { formatINR, initials } from '../utils/format';
import { palette } from '../theme';
import { MAX_STUDENTS } from '../config';

export default function StudentsScreen() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [students, setStudents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [full_name, setFull] = useState('');
  const [username, setUser] = useState('');
  const [password, setPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const s = await api.dashboard(token);
    setStudents(s.students);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const add = async () => {
    setErr(''); setSaving(true);
    try {
      await api.addStudent(token, username.trim(), full_name.trim(), password);
      setShowAdd(false); setFull(''); setUser(''); setPass('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const remove = (s) => {
    Alert.alert('Remove student', `Remove ${s.full_name}? This deletes their balance & transactions.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await api.deleteStudent(token, s.id); await load(); } },
    ]);
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: theme.text }]}>Students ({students.length}/{MAX_STUDENTS})</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: palette.primary }]} onPress={() => setShowAdd(true)}>
          <Text style={styles.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} style={{ flex: 1 }}>
        {students.map((s) => (
          <Card key={s.id}>
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
                <Text style={styles.avatarText}>{initials(s.full_name)}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.name, { color: theme.text }]}>{s.full_name}</Text>
                <Subtitle>@{s.username}</Subtitle>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.bal, { color: palette.success }]}>{formatINR(s.balance)}</Text>
                <TouchableOpacity onPress={() => remove(s)}><Text style={{ color: palette.danger, fontSize: 12 }}>Remove</Text></TouchableOpacity>
              </View>
            </View>
          </Card>
        ))}
        {students.length === 0 ? <Text style={[styles.empty, { color: theme.textMuted }]}>No students yet.</Text> : null}
      </ScrollView>

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Add Student</Text>
            <Input placeholder="Full Name" value={full_name} onChangeText={setFull} />
            <Input placeholder="Username (e.g. roll no)" value={username} onChangeText={setUser} autoCapitalize="none" />
            <Input placeholder="Password (optional)" value={password} onChangeText={setPass} secure />
            {err ? <Text style={{ color: palette.danger, marginBottom: 8 }}>{err}</Text> : null}
            <Button label={saving ? 'Saving…' : 'Save Student'} loading={saving} onPress={add} />
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
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '700' },
  bal: { fontSize: 15, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 24 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
});
