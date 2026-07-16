// src/screens/ReportsScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { LineChart, PieChart } from 'react-native-chart-kit';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Subtitle, Button } from '../components/ui';
import { api } from '../api';
import { formatINR } from '../utils/format';
import { palette } from '../theme';

const { width } = Dimensions.get('window');

export default function ReportsScreen() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [period, setPeriod] = useState('monthly');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const d = await api.reports(period);
    setData(d);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const chartConfig = {
    backgroundGradientFrom: theme.surface,
    backgroundGradientTo: theme.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(15, 118, 110, ${opacity})`,
    labelColor: (opacity = 1) => theme.textMuted,
    style: { borderRadius: 16 },
    propsForDots: { r: '4', strokeWidth: '2', stroke: palette.primary },
  };

  if (!data) return <Screen />;

  const lineLabels = data.series.map((s) => s.label);
  const lineData = {
    labels: lineLabels.length ? lineLabels : ['—'],
    datasets: [{ data: data.series.length ? data.series.map((s) => s.total_amount) : [0] }],
  };

  const pieData = [
    { name: 'Committee', amount: data.series.reduce((a, s) => a + s.total_committee, 0), color: palette.accent, legendFontColor: theme.text, legendFontSize: 12 },
    { name: 'Students', amount: data.series.reduce((a, s) => a + s.total_student, 0), color: palette.primary, legendFontColor: theme.text, legendFontSize: 12 },
  ];

  return (
    <Screen>
      <Text style={[styles.heading, { color: theme.text }]}>Reports</Text>
      <View style={styles.toggleRow}>
        <Button label="Monthly" variant={period === 'monthly' ? 'primary' : 'outline'} onPress={() => setPeriod('monthly')} style={styles.toggle} />
        <Button label="Yearly" variant={period === 'yearly' ? 'primary' : 'outline'} onPress={() => setPeriod('yearly')} style={styles.toggle} />
      </View>

      {data.series.length > 0 ? (
        <Card>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Total collected ({period})</Text>
          <LineChart data={lineData} width={width - 64} height={200} chartConfig={chartConfig} bezier style={styles.chart} />
        </Card>
      ) : (
        <Card><Subtitle>No data yet. Add jobs to see reports.</Subtitle></Card>
      )}

      <Card>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Distribution</Text>
        <PieChart
          data={pieData}
          width={width - 64}
          height={200}
          chartConfig={chartConfig}
          accessor="amount"
          backgroundColor="transparent"
          paddingLeft="20"
          absolute
        />
      </Card>

      <Card>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Job breakdown</Text>
        {data.jobs.map((j, i) => (
          <View key={i} style={styles.jobRow}>
            <Text style={[styles.jobName, { color: theme.text }]}>{j.name}</Text>
            <Text style={[styles.jobAmt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  toggle: { width: '48%' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  chart: { borderRadius: 16, marginVertical: 6 },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  jobName: { fontSize: 14 },
  jobAmt: { fontSize: 14, fontWeight: '700' },
});
