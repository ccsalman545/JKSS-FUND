// src/components/ui.js
// Shared, theme-aware UI building blocks.
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { palette } from '../theme';

const { width } = Dimensions.get('window');

export const Screen = ({ children, style }) => {
  const { theme } = useTheme();
  return <View style={[styles.screen, { backgroundColor: theme.background }, style]}>{children}</View>;
};

export const Card = ({ children, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.cardShadow }, style]}>
      {children}
    </View>
  );
};

export const Title = ({ children, style }) => {
  const { theme } = useTheme();
  return <Text style={[styles.title, { color: theme.text }, style]}>{children}</Text>;
};

export const Subtitle = ({ children, style }) => {
  const { theme } = useTheme();
  return <Text style={[styles.subtitle, { color: theme.textMuted }, style]}>{children}</Text>;
};

export const Button = ({ label, onPress, variant = 'primary', loading, disabled, style }) => {
  const { theme } = useTheme();
  const bg = variant === 'primary' ? palette.primary : variant === 'danger' ? palette.danger : variant === 'accent' ? palette.accent : theme.surfaceAlt;
  const fg = variant === 'outline' ? theme.text : '#ffffff';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, { backgroundColor: bg, borderColor: theme.border }, style, (disabled || loading) && { opacity: 0.6 }]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </TouchableOpacity>
  );
};

export const Input = ({ placeholder, value, onChangeText, secure, keyboardType, style, icon }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.inputWrap, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      {icon}
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        style={[styles.input, { color: theme.text }]}
      />
    </View>
  );
};

export const StatCard = ({ label, value, color }) => {
  const { theme } = useTheme();
  return (
    <Card style={styles.statCard}>
      <Text style={[styles.statValue, { color: color || palette.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3, marginBottom: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, marginVertical: 6 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, marginBottom: 12 },
  input: { flex: 1, paddingVertical: 12, fontSize: 16 },
  statCard: { width: (width - 48) / 2, marginBottom: 14 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 12, marginTop: 4 },
});
