// src/screens/TransactionsScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Subtitle } from '../components/ui';
import { api } from '../api';
import { formatINR, formatDateTime } from '../utils/format';
import { palette } from '../theme';

export default function TransactionsScreen({ route }) {
  const { token, user } = useAuth();
  const { theme } = useTheme();
  const studentId = route.params?.studentId; // admin-only: view a specific student
  const [txns, setTxns] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    let data;
    if (studentId && user?.role === 'admin') data = await api.studentTransactions(studentId);
    else data = await api.transactions();
    setTxns(data);
    const t = data.reduce((s, x) => s + (x.type === 'earning' ? x.amount : -x.amount), 0);
    setTotal(t);
  }, [token, studentId, user]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const earnings = txns.filter(t => t.type === 'earning').reduce((s, t) => s + t.amount, 0);
  const withdrawals = txns.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);

  return (
    <Screen>
      <Text style={[styles.heading, { color: theme.text }]}>Transactions</Text>
      <View style={styles.summaryRow}>
        <Card style={styles.summary}><Text style={{ color: palette.success, fontWeight: '800', fontSize: 16 }}>+{formatINR(earnings)}</Text><Subtitle>Earned</Subtitle></Card>
        <Card style={styles.summary}><Text style={{ color: palette.danger, fontWeight: '800', fontSize: 16 }}>-{formatINR(withdrawals)}</Text><Subtitle>Withdrawn</Subtitle></Card>
        <Card style={styles.summary}><Text style={{ color: theme.text, fontWeight: '800', fontSize: 16 }}>{formatINR(total)}</Text><Subtitle>Net</Subtitle></Card>
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
                <Text style={[styles.txnDate, { color: theme.textMuted }]}>{formatDateTime(t.createdAt?.toDate ? t.createdAt.toDate() : t.createdAt)}</Text>
              </View>
              <Text style={[styles.txnAmt, { color: t.type === 'earning' ? palette.success : palette.danger }]}>
                {t.type === 'earning' ? '+' : '-'}{formatINR(t.amount)}
              </Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summary: { width: '31%', alignItems: 'center', padding: 12 },
  txn: { padding: 12 },
  txnRow: { flexDirection: 'row', alignItems: 'center' },
  txnIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txnIconText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  txnDesc: { fontSize: 14, fontWeight: '600' },
  txnDate: { fontSize: 12, marginTop: 2 },
  txnAmt: { fontSize: 15, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 24 },
});
