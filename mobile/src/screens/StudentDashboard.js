// src/screens/StudentDashboard.js
// Student home: greeting, gradient balance hero, quick actions, recent activity.
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, GradientCard, Button, SectionHeader, TxnRow, EmptyState,
  Sheet, Input, Chip, IconButton,
} from '../components/ui';
import { api } from '../api';
import { formatINR, timeGreeting, sameMonth } from '../utils/format';
import { palette } from '../theme';

const QUICK_AMOUNTS = [100, 200, 500];

export default function StudentDashboard({ navigation }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [info, setInfo] = useState({ balance: 0, committeeBalance: 0, full_name: user?.full_name || '' });
  const [txns, setTxns] = useState([]);
  const [hidden, setHidden] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [wError, setWError] = useState('');

  // Real-time: balance + transactions update live when admin adds a job.
  useEffect(() => {
    const u1 = api.subscribeBalance(setInfo);
    const u2 = api.subscribeTransactions(setTxns);
    return () => { u1(); u2(); };
  }, []);

  const name = info.full_name || user?.full_name || 'Student';
  const monthEarnings = txns
    .filter((t) => t.type === 'earning' && sameMonth(t.createdAt))
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const balanceText = hidden ? '₹ ••••••' : formatINR(info.balance);

  const withdraw = async () => {
    setWError('');
    setWLoading(true);
    try {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error('Enter a valid amount');
      if (amt > Number(info.balance || 0)) throw new Error('Amount is more than your balance');
      await api.withdraw(amt, desc.trim() || 'Withdrawal');
      setShowWithdraw(false);
      setAmount('');
      setDesc('');
    } catch (e) {
      setWError(e.message?.replace('Firebase: ', '') || 'Could not process withdrawal');
    } finally {
      setWLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { color: theme.textMuted }]}>{timeGreeting()},</Text>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{name}</Text>
        </View>
        <View
          style={[styles.avatar, { backgroundColor: theme.mode === 'dark' ? 'rgba(99,102,241,0.2)' : palette.primarySoft }]}
        >
          <Ionicons name="person" size={20} color={theme.mode === 'dark' ? '#A5B4FC' : palette.primaryDark} />
        </View>
      </View>

      <GradientCard style={styles.balanceCard}>
        <View style={styles.balanceTop}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10} style={styles.eyeBtn}>
            <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
        <Text style={styles.balanceValue}>{balanceText}</Text>
        <View style={styles.chipRow}>
          <View style={styles.glassChip}>
            <Ionicons name="shield-checkmark-outline" size={13} color="rgba(255,255,255,0.9)" />
            <Text style={styles.glassChipText}>
              Committee {hidden ? '••••' : formatINR(info.committeeBalance)}
            </Text>
          </View>
          <View style={styles.glassChip}>
            <Ionicons name="trending-up" size={13} color="#FCD34D" />
            <Text style={styles.glassChipText}>
              This month {hidden ? '••••' : '+' + formatINR(monthEarnings)}
            </Text>
          </View>
        </View>
      </GradientCard>

      <View style={styles.actionsRow}>
        <Button label="Withdraw" icon="cash-outline" variant="accent" onPress={() => { setWError(''); setShowWithdraw(true); }} style={{ flex: 1 }} />
        <Button label="History" icon="receipt-outline" variant="soft" onPress={() => navigation.navigate('History')} style={{ flex: 1, marginLeft: 10 }} />
      </View>

      <SectionHeader title="Recent activity" action="See all" onAction={() => navigation.navigate('History')} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {txns.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="No transactions yet"
            subtitle="When your hostel admin adds a job, your share will appear here instantly."
          />
        ) : (
          txns.slice(0, 6).map((t, i) => <TxnRow key={t.id} txn={t} last={i === Math.min(txns.length, 6) - 1} />)
        )}
      </ScrollView>

      <Sheet visible={showWithdraw} onClose={() => setShowWithdraw(false)} title="Withdraw money">
        <View style={[styles.withdrawAvail, { backgroundColor: theme.mode === 'dark' ? 'rgba(16,185,129,0.12)' : palette.successSoft }]}>
          <Ionicons name="wallet-outline" size={16} color={theme.mode === 'dark' ? '#34D399' : '#059669'} />
          <Text style={[styles.withdrawAvailText, { color: theme.mode === 'dark' ? '#34D399' : '#059669' }]}>
            Available: {formatINR(info.balance)}
          </Text>
        </View>

        <Input
          icon="cash-outline"
          prefix="₹"
          placeholder="Amount"
          keyboardType="numeric"
          value={amount}
          onChangeText={(t) => { setAmount(t); setWError(''); }}
          error={wError || undefined}
        />

        <View style={{ flexDirection: 'row', marginBottom: 14 }}>
          {QUICK_AMOUNTS.map((q) => (
            <Chip
              key={q}
              label={'₹' + q}
              active={amount === String(q)}
              onPress={() => setAmount(String(q))}
            />
          ))}
          <Chip
            label="Max"
            active={amount === String(info.balance)}
            onPress={() => setAmount(String(Math.floor(Number(info.balance || 0) * 100) / 100))}
          />
        </View>

        <Input
          icon="note-outline"
          placeholder="Reason (optional)"
          value={desc}
          onChangeText={setDesc}
          style={{ marginBottom: 6 }}
        />

        <Button
          label={wLoading ? 'Processing…' : 'Confirm withdrawal'}
          loading={wLoading}
          onPress={withdraw}
          variant="accent"
          size="lg"
          icon="arrow-down-circle-outline"
          style={{ marginTop: 6 }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  greeting: { fontSize: 13, fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 1 },
  avatar: {
    width: 46, height: 46, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  balanceCard: { padding: 22, marginBottom: 16 },
  balanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13.5, fontWeight: '600', letterSpacing: 0.3 },
  eyeBtn: { padding: 4 },
  balanceValue: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -1, marginVertical: 6 },
  chipRow: { flexDirection: 'row', marginTop: 6 },
  glassChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8,
  },
  glassChipText: { color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 6 },
  actionsRow: { flexDirection: 'row', marginBottom: 4 },
  withdrawAvail: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  withdrawAvailText: { fontSize: 13.5, fontWeight: '800', marginLeft: 8 },
});
