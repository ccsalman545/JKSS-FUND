// src/screens/ReportsScreen.js
// Admin: reports — monthly/yearly toggle, collection trend, donut split, job breakdown.
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { LineChart, PieChart } from 'react-native-chart-kit';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Header, Card, Segmented, EmptyState } from '../components/ui';
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
  }, [period, token]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <Screen />;

  const primaryRgb = theme.mode === 'dark' ? '91, 84, 240' : '79, 70, 229';
  const chartConfig = {
    backgroundGradientFrom: theme.surface,
    backgroundGradientTo: theme.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(${primaryRgb}, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(${theme.textMuted === '#94A3B8' ? '148,163,184' : '100,116,139'}, ${opacity})`,
    propsForDots: { r: '4', strokeWidth: '2', stroke: palette.primary },
  };

  const lineData = {
    labels: data.series.length ? data.series.map((s) => s.label) : ['—'],
    datasets: [{ data: data.series.length ? data.series.map((s) => s.total_amount) : [0] }],
  };

  const committeeTotal = data.series.reduce((a, s) => a + s.total_committee, 0);
  const studentTotal = data.series.reduce((a, s) => a + s.total_student, 0);
  const grandTotal = committeeTotal + studentTotal;

  const pieData = [
    { name: 'Committee', amount: committeeTotal, color: palette.accent, legendFontColor: theme.text, legendFontSize: 12 },
    { name: 'Students', amount: studentTotal, color: palette.primary, legendFontColor: theme.text, legendFontSize: 12 },
  ];

  const maxJob = Math.max(1, ...data.jobs.map((j) => Number(j.amount || 0)));

  return (
    <Screen>
      <Header title="Reports" subtitle="Collections & distribution" />

      <Segmented
        options={[
          { label: 'Monthly', value: 'monthly' },
          { label: 'Yearly', value: 'yearly' },
        ]}
        value={period}
        onChange={setPeriod}
        style={{ marginBottom: 14 }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
      {data.series.length > 0 ? (
        <Card style={styles.chartCard}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Total collected</Text>
          <LineChart
            data={lineData}
            width={width - 80}
            height={210}
            chartConfig={chartConfig}
            bezier
            withInnerLines
            style={styles.chart}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="bar-chart-outline"
            title="No data yet"
            subtitle="Add jobs to see collection trends here."
          />
        </Card>
      )}

      <Card style={styles.chartCard}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>Distribution</Text>
        {grandTotal > 0 ? (
          <View style={{ height: 200, justifyContent: 'center', alignItems: 'center' }}>
            <PieChart
              data={pieData}
              width={width - 80}
              height={190}
              chartConfig={chartConfig}
              accessor="amount"
              backgroundColor="transparent"
              paddingLeft="20"
              absolute
            />
            <View style={[styles.donutHole, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[styles.donutValue, { color: theme.text }]} numberOfLines={1}>{formatINR(grandTotal)}</Text>
              <Text style={[styles.donutLabel, { color: theme.textMuted }]}>collected</Text>
            </View>
          </View>
        ) : (
          <EmptyState icon="pie-chart-outline" title="Nothing to distribute" subtitle="Job collections will appear here." />
        )}
      </Card>

      {data.jobs.length > 0 ? (
        <Card>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Job breakdown</Text>
          {data.jobs.map((j, i) => (
            <View key={j.id} style={[styles.jobRow, i > 0 && { borderTopWidth: 1, borderColor: theme.border }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.jobName, { color: theme.text }]} numberOfLines={1}>{j.name}</Text>
                <View style={[styles.jobBarTrack, { backgroundColor: theme.surfaceAlt, marginTop: 7 }]}>
                  <View
                    style={[styles.jobBarFill, { width: `${(Number(j.amount || 0) / maxJob) * 100}%` }]}
                  />
                </View>
              </View>
              <Text style={[styles.jobAmt, { color: theme.text }]}>{formatINR(j.amount)}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chartCard: { marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10, letterSpacing: -0.2 },
  chart: { borderRadius: 16, marginVertical: 6 },
  donutHole: {
    position: 'absolute',
    top: 36,
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  donutValue: { fontSize: 12.5, fontWeight: '800', letterSpacing: -0.2 },
  donutLabel: { fontSize: 9.5, fontWeight: '600', marginTop: 1 },
  jobRow: { paddingVertical: 12 },
  jobName: { fontSize: 13.5, fontWeight: '700' },
  jobAmt: { fontSize: 13.5, fontWeight: '800' },
  jobBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  jobBarFill: {
    height: 6, borderRadius: 3,
    backgroundColor: palette.primary,
  },
});
