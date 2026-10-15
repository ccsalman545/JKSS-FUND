// src/screens/TransactionsScreen.js
// Full ledger: summary, filter chips, transactions grouped by month.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, FadeIn, Header, Card, Chip, TxnRow, EmptyState,
} from '../components/ui';
import { api } from '../api';
import { formatINR, monthLabel, asDate } from '../utils/format';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'earning', label: 'Earnings' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'reversal', label: 'Reversed' },
];

export default function TransactionsScreen({ route, navigation }) {
  const { token, user } = useAuth();
  const { theme } = useTheme();
  const studentId = route.params?.studentId; // admin-only: view a specific student
  const [txns, setTxns] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    let data;
    if (studentId && user?.role === 'admin') data = await api.studentTransactions(studentId);
    else data = await api.transactions();
    const sorted = (data || []).slice().sort((a, b) => asDate(b.createdAt) - asDate(a.createdAt));
    setTxns(sorted);
  }, [token, studentId, user]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(
    () => (filter === 'all' ? txns : txns.filter((t) => t.type === filter)),
    [txns, filter]
  );

  // Paise-exact totals (reversals are debits, like withdrawals).
  const paiseSum = (type) =>
    txns.filter((t) => t.type === type).reduce((s, t) => s + Math.round(Number(t.amount || 0) * 100), 0);
  const earnings = paiseSum('earning') / 100;
  const withdrawals = paiseSum('withdrawal') / 100;
  const reversals = paiseSum('reversal') / 100;
  const net = earnings - withdrawals - reversals;

  // Group by month label, preserving order.
  const groups = useMemo(() => {
    const out = [];
    const idx = {};
    filtered.forEach((t) => {
      const label = monthLabel(t.createdAt);
      if (!(label in idx)) {
        idx[label] = out.length;
        out.push({ label, items: [] });
      }
      out[idx[label]].items.push(t);
    });
    return out;
  }, [filtered]);

  return (
    <Screen>
      <FadeIn navigation={navigation}>
      <Header
        title="History"
        subtitle={studentId && user?.role === 'admin' ? 'Student ledger' : 'Your complete ledger'}
      />

      <Card noPad style={styles.summary}>
        {[
          { value: '+' + formatINR(earnings), label: 'Earned', color: theme.success },
          { value: '-' + formatINR(withdrawals), label: 'Withdrawn', color: theme.danger },
          ...(reversals > 0 ? [{ value: '-' + formatINR(reversals), label: 'Reversed', color: theme.textMuted }] : []),
          { value: formatINR(net), label: 'Net', color: theme.text },
        ].map((s, i) => (
          <View key={s.label} style={[styles.summaryCol, i > 0 && { borderLeftWidth: 1, borderColor: theme.border }]}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>{s.label}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {groups.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={filter === 'all' ? 'No transactions yet' : 'Nothing here'}
            subtitle={filter === 'all' ? 'Earnings and withdrawals will show up here in real time.' : 'Try a different filter.'}
          />
        ) : (
          groups.map((g) => (
            <View key={g.label}>
              <Text style={[styles.monthLabel, { color: theme.textFaint }]}>{g.label}</Text>
              {g.items.map((t, i) => (
                <TxnRow key={t.id} txn={t} last={i === g.items.length - 1} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', marginBottom: 14, padding: 0, overflow: 'hidden' },
  summaryCol: {
    flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6,
    borderLeftWidth: 1,
  },
  summaryValue: { fontSize: 15.5, fontWeight: '800', letterSpacing: -0.3 },
  summaryLabel: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  filterRow: { flexDirection: 'row', marginBottom: 14 },
  monthLabel: {
    fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 8, marginTop: 6,
  },
});
