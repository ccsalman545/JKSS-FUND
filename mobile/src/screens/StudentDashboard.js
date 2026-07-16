// src/screens/StudentDashboard.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, ScrollView, Modal, TextInput, Dimensions } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Button, Subtitle } from '../components/ui';
import { api } from '../api';
import { formatINR, formatDateTime, initials } from '../utils/format';
import { palette } from '../theme';

export default function StudentDashboard({ navigation }) {
  const { token, user } = useAuth();
  const { theme } = useTheme();
  const [balance, setBalance] = useState(0);
  const [committee, setCommittee] = useState(0);
  const [txns, setTxns] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [wError, setWError] = useState('');

  const load = useCallback(async () => {
    const b = await api.balance(token);
    setBalance(b.balance);
    setCommittee(b.committeeBalance);
    const t = await api.transactions(token);
    setTxns(t.slice(0, 8));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const withdraw = async () => {
    setWError(''); setWLoading(true);
    try {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error('Enter a valid amount');
      await api.withdraw(token, amt, desc || 'Withdrawal');
      setShowWithdraw(false); setAmount(''); setDesc('');
      await load();
    } catch (e) { setWError(e.message); }
    finally { setWLoading(false); }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Subtitle>Welcome back,</Subtitle>
          <Text style={[styles.name, { color: theme.text }]}>{user?.full_name || 'Student'}</Text>
        </View>
        <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
          <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
        </View>
      </View>

      <Card style={[styles.balanceCard, { backgroundColor: palette.primary }]}>
        <Text style={styles.balanceLabel}>Your Balance</Text>
        <Text style={styles.balanceValue}>{formatINR(balance)}</Text>
        <Text style={styles.committee}>Committee Fund: {formatINR(committee)}</Text>
        <Button label="Withdraw" variant="accent" onPress={() => setShowWithdraw(true)} style={styles.withdrawBtn} />
      </Card>

      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Recent Activity</Text>
        <TouchableOpacity onPress={() => navigation.navigate('History')}>
          <Text style={{ color: palette.info }}>See all</Text>
        </TouchableOpacity>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} style={{ flex: 1 }}>
        {txns.length === 0 ? <Text style={[styles.empty, { color: theme.textMuted }]}>No transactions yet.</Text> : null}
        {txns.map((t) => (
          <Card key={t.id} style={styles.txn}>
            <View style={styles.txnRow}>
              <View style={[styles.txnIcon, { backgroundColor: t.type === 'earning' ? palette.success : palette.danger }]}>
                <Text style={styles.txnIconText}>{t.type === 'earning' ? '+' : '-'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txnDesc, { color: theme.text }]}>{t.description}</Text>
                <Text style={[styles.txnDate, { color: theme.textMuted }]}>{formatDateTime(t.created_at)}</Text>
              </View>
              <Text style={[styles.txnAmt, { color: t.type === 'earning' ? palette.success : palette.danger }]}>
                {t.type === 'earning' ? '+' : '-'}{formatINR(t.amount)}
              </Text>
            </View>
          </Card>
        ))}
      </ScrollView>

      <Modal visible={showWithdraw} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Withdraw Money</Text>
            <Subtitle>Available: {formatINR(balance)}</Subtitle>
            <TextInput placeholder="Amount (₹)" keyboardType="numeric" value={amount}
              onChangeText={setAmount} placeholderTextColor={theme.textMuted}
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]} />
            <TextInput placeholder="Reason (optional)" value={desc}
              onChangeText={setDesc} placeholderTextColor={theme.textMuted}
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt }]} />
            {wError ? <Text style={{ color: palette.danger, marginBottom: 8 }}>{wError}</Text> : null}
            <Button label={wLoading ? 'Processing…' : 'Confirm Withdraw'} loading={wLoading} onPress={withdraw} variant="accent" />
            <Button label="Cancel" variant="outline" onPress={() => setShowWithdraw(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  name: { fontSize: 20, fontWeight: '700' },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  balanceCard: { padding: 22, borderRadius: 20, marginBottom: 18 },
  balanceLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  balanceValue: { color: '#fff', fontSize: 36, fontWeight: '800', marginVertical: 4 },
  committee: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginBottom: 14 },
  withdrawBtn: { alignSelf: 'flex-start', paddingHorizontal: 28 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  txn: { padding: 12 },
  txnRow: { flexDirection: 'row', alignItems: 'center' },
  txnIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txnIconText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  txnDesc: { fontSize: 14, fontWeight: '600' },
  txnDate: { fontSize: 12, marginTop: 2 },
  txnAmt: { fontSize: 15, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 24 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  modalInput: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12, fontSize: 16 },
});
