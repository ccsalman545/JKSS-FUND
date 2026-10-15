// src/screens/NotAuthorizedScreen.js
//
// Shown when a Firebase Authentication session exists but the account has NO
// admin-pre-authorized `users/{identifier}` profile document.
//
// Students are pre-authorized by the admin (Students screen → Add student, or
// the one-time provisioning tool). Until that document exists this screen is
// the ONLY thing the session can reach: the dashboard, balances, ledger and
// every write stay closed (and the Firestore rules deny those paths as well —
// there is no self-create path at all).
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, Pressable } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { APP_NAME } from '../config';

export default function NotAuthorizedScreen() {
  const { logout, token } = useAuth();
  const { theme } = useTheme();

  return (
    <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.root}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 26 }}>
        <View style={styles.glass}>
          <View style={styles.iconWrap}>
            <Ionicons name="hourglass-outline" size={32} color="#fff" />
          </View>
          <Text style={styles.title}>Awaiting admin authorization</Text>
          <Text style={styles.body}>
            You are signed in, but this account is not on the fund's student roster yet.
            Ask the admin to add you (Students → Add student). Then sign in again.
          </Text>
          <Text style={styles.mono} numberOfLines={1}>{token || ''}</Text>

          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            onPress={logout}
          >
            <View style={styles.btnInner}>
              <Ionicons name="log-out-outline" size={17} color={theme.mode === 'dark' ? '#DCD9FF' : '#1A1468'} />
              <Text style={[styles.btnText, { color: theme.mode === 'dark' ? '#DCD9FF' : '#1A1468' }]}>
                Sign out
              </Text>
            </View>
          </Pressable>

          <Text style={styles.fine}>
            {APP_NAME} · access to balances and transactions is granted only after the
            admin pre-authorizes your profile.
          </Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glass: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderWidth: 1,
    borderRadius: 24,
    padding: 26,
    alignItems: 'center',
  },
  iconWrap: {
    width: 62, height: 62, borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  body: {
    color: 'rgba(255,255,255,0.85)', fontSize: 13.5, textAlign: 'center',
    lineHeight: 20, marginTop: 10,
  },
  mono: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'monospace', marginTop: 14 },
  btn: { marginTop: 20, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 26 },
  btnText: { fontWeight: '800', fontSize: 15, marginLeft: 8 },
  fine: {
    color: 'rgba(255,255,255,0.6)', fontSize: 11, textAlign: 'center',
    marginTop: 18, lineHeight: 16,
  },
});
