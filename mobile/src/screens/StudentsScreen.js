// src/screens/StudentsScreen.js
// Admin: manage students — search, list, add (sheet), remove (confirm sheet).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, FadeIn, Header, Card, Button, Input, Avatar, IconButton,
  Sheet, ConfirmSheet, EmptyState,
} from '../components/ui';
import { api } from '../api';
import { formatINR } from '../utils/format';
import { MAX_STUDENTS, STUDENT_EMAIL_DOMAIN } from '../config';
import { identifierFor, isValidUsername, normalizeUsername } from '../identity';

export default function StudentsScreen({ navigation }) {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [students, setStudents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [full_name, setFull] = useState('');
  const [username, setUser] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    const d = await api.dashboard();
    setStudents(d.students);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => (s.full_name || '').toLowerCase().includes(q) || (s.username || '').toLowerCase().includes(q)
    );
  }, [students, query]);

  // v3.0: the admin authorizes a student by USERNAME (no email address is
  // needed or stored). The profile document is created at the synthetic
  // identifier that username maps to — the exact ID the student's sign-in
  // produces, which is what makes the login work.
  const normalizedUsername = normalizeUsername(username);
  const usernameValid = normalizedUsername ? isValidUsername(normalizedUsername) : null;

  const add = async () => {
    setErr('');
    if (usernameValid === false) {
      setErr('Usernames use letters, numbers, dots, dashes and underscores (3–48 characters).');
      return;
    }
    setSaving(true);
    try {
      await api.addStudent(username, full_name);
      setShowAdd(false);
      setFull('');
      setUser('');
      await load();
    } catch (e) {
      setErr(e.message?.replace('Firebase: ', '') || 'Could not add student');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    // Tombstone removal: preserves the student's balance + ledger so future
    // job reversals and audits stay intact. They stop receiving new splits.
    await api.removeStudent(toDelete.id);
    setToDelete(null);
    await load();
  };

  return (
    <Screen>
      <FadeIn navigation={navigation}>
      <Header
        title="Students"
        subtitle={`${students.length} of ${MAX_STUDENTS} seats used`}
        right={
          <Button label="Add" icon="add" size="sm" variant="container" onPress={() => { setErr(''); setShowAdd(true); }} style={{ marginLeft: 12 }} />
        }
      />

      <Input
        icon="search-outline"
        placeholder="Search by name or username"
        autoCapitalize="none"
        value={query}
        onChangeText={setQuery}
        style={{ marginBottom: 14 }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={query ? 'search-outline' : 'people-outline'}
            title={query ? 'No matches' : 'No students yet'}
            subtitle={query ? 'Try a different search.' : 'Add your first student to start sharing funds.'}
          />
        ) : (
          <Card noPad>
            {filtered.map((s, i) => (
              <View key={s.id} style={[styles.row, i < filtered.length - 1 && { borderBottomWidth: 1, borderColor: theme.border }]}>
                <Avatar name={s.full_name} size={42} />
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{s.full_name}</Text>
                  <Text style={[styles.handle, { color: theme.textFaint }]} numberOfLines={1}>@{s.username}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.balance, { color: theme.success }]}>{formatINR(s.balance || 0)}</Text>
                  <IconButton
                    icon="trash-outline"
                    tint={theme.danger}
                    size={32}
                    style={{ marginTop: 4 }}
                    onPress={() => setToDelete(s)}
                  />
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
      </FadeIn>

      <Sheet visible={showAdd} onClose={() => setShowAdd(false)} title="Add student">
        <Input
          icon="person-outline"
          label="Full name"
          placeholder="e.g. Salmaan Khan"
          value={full_name}
          onChangeText={(t) => { setFull(t); setErr(''); }}
        />
        <Input
          icon="person-outline"
          label="Assigned username"
          placeholder="e.g. thangal"
          autoCapitalize="none"
          autoCorrect={false}
          prefix="@"
          value={username}
          onChangeText={(t) => { setUser(t); setErr(''); }}
          error={usernameValid === false ? 'Invalid username' : undefined}
          style={{ marginBottom: 4 }}
        />
        <Text style={[styles.hint, { color: theme.textFaint }]}>
          The student signs in with this username and password — no email address is needed.
          {'\n\n'}Pre-authorizes the profile{' '}
          <Text style={{ fontFamily: 'monospace' }}>
            {usernameValid ? identifierFor(normalizedUsername) : '<username>@' + STUDENT_EMAIL_DOMAIN}
          </Text>
          {'\n'}A sign-in with any other username has no profile and cannot open the dashboard.
        </Text>
        <Text style={[styles.hint, { color: theme.textFaint }]}>
          Create the login itself with the admin tool (tools/provision) — it sets the username and a
          one-time random password together. This sheet only pre-authorizes the profile.
        </Text>
        <Button
          label={saving ? 'Saving…' : 'Save student'}
          loading={saving}
          onPress={add}
          size="lg"
          icon="person-add-outline"
          style={{ marginTop: 6 }}
        />
      </Sheet>

      <ConfirmSheet
        visible={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        title="Remove from roster?"
        message={`${toDelete?.full_name || 'This student'} will stop receiving job splits. Their balance and full transaction history are preserved for audit and for reversing past jobs.`}
        confirmLabel="Remove"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  name: { fontSize: 14.5, fontWeight: '700' },
  handle: { fontSize: 12, marginTop: 2 },
  balance: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: -6, marginBottom: 10 },
});
