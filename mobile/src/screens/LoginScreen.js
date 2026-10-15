// src/screens/LoginScreen.js
// Full-bleed gradient hero + floating glass form card.
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Keyboard } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button, Input, FadeIn } from '../components/ui';
import { APP_NAME, GOOGLE_SIGNIN_CONFIGURED } from '../config';

export default function LoginScreen() {
  const { login, googleLogin } = useAuth();
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  const onLogin = async () => {
    Keyboard.dismiss();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setError(e.message?.replace('Firebase: ', '') || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    Keyboard.dismiss();
    setError('');
    setGLoading(true);
    try {
      await googleLogin('student');
    } catch (e) {
      setError(e.message?.replace('Firebase: ', '') || 'Google sign-in failed');
    } finally {
      setGLoading(false);
    }
  };

  return (
    <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.root}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.deco1} />
        <View style={styles.deco2} />

        <FadeIn>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoRupee}>₹</Text>
            </View>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.tagline}>Hostel fund, made transparent</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.mode === 'light' ? 'transparent' : theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Sign in</Text>
            <Text style={[styles.cardSub, { color: theme.textMuted }]}>
              {GOOGLE_SIGNIN_CONFIGURED
                ? 'Students use Google · Admins use their credentials'
                : 'Sign in with your email and password'}
            </Text>

            {GOOGLE_SIGNIN_CONFIGURED ? (
              <Button
                label={gLoading ? 'Signing in…' : 'Continue with Google'}
                variant="outline"
                icon="logo-google"
                loading={gLoading}
                onPress={onGoogle}
                size="lg"
                style={styles.googleBtn}
              />
            ) : (
              <Text style={[styles.googleNote, { color: theme.textFaint }]}>
                Google sign-in is not configured yet — email sign-in works for all roles.
              </Text>
            )}

            {GOOGLE_SIGNIN_CONFIGURED && (
              <View style={[styles.dividerRow, { borderColor: theme.border }]}>
                <View style={{ flex: 1 }} />
                <Text style={[styles.dividerText, { color: theme.textFaint }]}>OR</Text>
                <View style={{ flex: 1 }} />
              </View>
            )}

            <Input
              icon="mail-outline"
              placeholder="Email or username"
              autoCapitalize="none"
              autoComplete="email"
              value={username}
              onChangeText={(t) => { setUsername(t); setError(''); }}
            />
            <Input
              icon="lock-closed-outline"
              placeholder="Password"
              secure
              value={password}
              onChangeText={(t) => { setPassword(t); setError(''); }}
            />

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text>
              </View>
            ) : null}

            <Button label={loading ? 'Signing in…' : 'Login'} loading={loading} onPress={onLogin} size="lg" icon="log-in-outline" />
          </View>

          <Text style={styles.footer}>
            10% of every job goes to the committee fund,{'\n'}90% is split equally among students.
          </Text>
        </ScrollView>
        </FadeIn>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  deco1: {
    position: 'absolute', top: -100, right: -70, width: 260, height: 260,
    borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deco2: {
    position: 'absolute', top: 160, left: -110, width: 240, height: 240,
    borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scroll: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  brand: { alignItems: 'center', marginBottom: 30, marginTop: 8 },
  logo: {
    width: 76, height: 76, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  logoRupee: { color: '#fff', fontSize: 38, fontWeight: '800' },
  appName: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 6, fontWeight: '500' },
  card: {
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    shadowColor: 'rgba(0, 0, 0, 0.25)',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 12,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  cardSub: { fontSize: 12.5, marginTop: 4, marginBottom: 18, lineHeight: 18 },
  googleBtn: { marginBottom: 16 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, borderTopWidth: 0 },
  dividerText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 11, marginBottom: 12, gap: 8,
  },
  errorText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  footer: {
    color: 'rgba(255,255,255,0.75)', fontSize: 12, textAlign: 'center',
    marginTop: 22, lineHeight: 19, fontWeight: '500',
  },
});
