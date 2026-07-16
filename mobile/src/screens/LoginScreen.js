// src/screens/LoginScreen.js
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Input, Button, Title, Subtitle } from '../components/ui';
import { palette, APP_NAME } from '../config';

export default function LoginScreen() {
  const { login, googleLogin } = useAuth();
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  const onLogin = async () => {
    setError(''); setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const onGoogle = async () => {
    setError(''); setGLoading(true);
    try {
      await googleLogin('student');
    } catch (e) {
      setError(e.message || 'Google sign-in failed');
    } finally { setGLoading(false); }
  };

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.logo, { backgroundColor: palette.primary }]}>
          <Text style={styles.logoText}>₹</Text>
        </View>
        <Title style={styles.appName}>{APP_NAME}</Title>
        <Subtitle>Hostel Fund Management</Subtitle>
      </View>

      <Card>
        <Button
          label={gLoading ? 'Signing in…' : 'Continue with Google'}
          variant="outline"
          loading={gLoading}
          onPress={onGoogle}
          style={styles.google}
        />
        <View style={styles.dividerRow}>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
          <Text style={[styles.dividerText, { color: theme.textMuted }]}>OR</Text>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
        </View>

        <Input placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Input placeholder="Password" value={password} onChangeText={setPassword} secure />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={loading ? 'Please wait…' : 'Login'} loading={loading} onPress={onLogin} />
      </Card>

      <Text style={[styles.footer, { color: theme.textMuted }]}>
        Students: use Google or your given credentials.{'\n'}Admins: use the password provided by the system owner.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  logoText: { color: '#fff', fontSize: 36, fontWeight: '800' },
  appName: { fontSize: 28, textAlign: 'center' },
  google: { flexDirection: 'row', justifyContent: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  line: { flex: 1, height: 1 },
  dividerText: { marginHorizontal: 10, fontSize: 12 },
  error: { color: palette.danger, marginBottom: 8, fontSize: 13 },
  footer: { textAlign: 'center', fontSize: 12, marginTop: 8, lineHeight: 18 },
});
