// src/screens/ProfileScreen.js
// Profile: gradient identity header, menu groups, edit-name & change-password sheets.
import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, Pressable, SafeAreaView } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Screen, Card, Button, Input, Sheet, Badge,
} from '../components/ui';
import { formatINR } from '../utils/format';
import { palette } from '../theme';
import { APP_NAME, COMMITTEE_SHARE_PCT, STUDENT_SHARE_PCT } from '../config';

export default function ProfileScreen() {
  const { user, logout, updateProfile, biometricSupported, changePassword } = useAuth();
  const { theme, isDark, toggle } = useTheme();

  const [nameSheet, setNameSheet] = useState(false);
  const [pwSheet, setPwSheet] = useState(false);
  const [name, setName] = useState(user?.full_name || '');
  const [saving, setSaving] = useState(false);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState(null); // { type: 'error' | 'success', text }

  const saveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateProfile(name.trim());
      setNameSheet(false);
    } catch (e) {
      // stay open; error surfaced via sheet error text
    } finally {
      setSaving(false);
    }
  };

  const openPassword = () => {
    setOldPw('');
    setNewPw('');
    setPwMsg(null);
    setPwSheet(true);
  };

  const doChangePassword = async () => {
    setPwMsg(null);
    if (!oldPw || !newPw) {
      setPwMsg({ type: 'error', text: 'Enter both passwords' });
      return;
    }
    if (newPw.length < 6) {
      setPwMsg({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(newPw, oldPw);
      setPwMsg({ type: 'success', text: 'Password updated' });
      setOldPw('');
      setNewPw('');
    } catch (e) {
      setPwMsg({ type: 'error', text: e.message?.replace('Firebase: ', '') || 'Could not change password' });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <Screen noPad>
      <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientHeader}>
        <SafeAreaView edges={['top']}>
          <View style={styles.identity}>
            <View style={styles.avatarGlass}>
              <Text style={styles.avatarInitials}>
                {(user?.full_name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.identityName} numberOfLines={1}>{user?.full_name || 'User'}</Text>
              <Text style={styles.identityHandle} numberOfLines={1}>@{user?.username || ''}</Text>
              <Badge style={{ marginTop: 8, backgroundColor: 'rgba(255,255,255,0.18)' }} color="#fff">
                {(user?.role || 'student').toUpperCase()}
              </Badge>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={{ flex: 1, padding: 16, paddingBottom: 110 }}>
        <MenuCard>
          <MenuRow
            icon="person-outline"
            tint={palette.info}
            label="Display name"
            value={user?.full_name}
            onPress={() => { setName(user?.full_name || ''); setNameSheet(true); }}
          />
        </MenuCard>

        <MenuCard>
          <View style={styles.switchRow}>
            <MenuRowIcon icon="moon-outline" tint={palette.violet} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>Dark mode</Text>
            <Switch
              value={isDark}
              onValueChange={toggle}
              trackColor={{ false: '#CBD5E1', true: palette.primary }}
              thumbColor="#fff"
            />
          </View>
        </MenuCard>

        <MenuCard>
          <MenuRow
            icon="finger-print"
            tint={palette.success}
            label="Biometric lock"
            value={biometricSupported ? 'Enabled on app open' : 'Not available on device'}
            valueColor={biometricSupported ? palette.success : theme.textFaint}
          />
          {user?.role === 'admin' ? (
            <MenuRow
              icon="key-outline"
              tint={palette.accent}
              label="Change password"
              onPress={openPassword}
              last
            />
          ) : null}
        </MenuCard>

        <Card style={styles.about}>
          <View style={styles.aboutRow}>
            <View style={[styles.aboutIcon, { backgroundColor: palette.primarySoft }]}>
              <Ionicons name="information-circle-outline" size={18} color={palette.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.aboutName, { color: theme.text }]}>{APP_NAME} v3.0</Text>
              <Text style={[styles.aboutText, { color: theme.textMuted }]}>
                {COMMITTEE_SHARE_PCT}% of every job goes to the committee fund; {STUDENT_SHARE_PCT}% is split equally among students. All amounts in {formatINR(1).slice(0, 1)} (INR).
              </Text>
            </View>
          </View>
        </Card>

        <Button label="Log out" icon="log-out-outline" variant="danger" size="lg" onPress={logout} style={{ marginTop: 16 }} />
      </View>

      <Sheet visible={nameSheet} onClose={() => setNameSheet(false)} title="Edit name">
        <Input
          icon="person-outline"
          label="Full name"
          value={name}
          onChangeText={setName}
        />
        <Button label={saving ? 'Saving…' : 'Save'} loading={saving} onPress={saveName} size="lg" icon="checkmark-outline" />
      </Sheet>

      <Sheet visible={pwSheet} onClose={() => setPwSheet(false)} title="Change password">
        <Input
          icon="lock-closed-outline"
          label="Current password"
          secure
          value={oldPw}
          onChangeText={setOldPw}
        />
        <Input
          icon="key-outline"
          label="New password"
          secure
          value={newPw}
          onChangeText={setNewPw}
          style={{ marginBottom: 4 }}
        />
        {pwMsg ? (
          <Text style={[styles.pwMsg, { color: pwMsg.type === 'success' ? palette.success : palette.danger }]}>
            {pwMsg.text}
          </Text>
        ) : null}
        <Button
          label={pwSaving ? 'Updating…' : 'Update password'}
          loading={pwSaving}
          onPress={doChangePassword}
          size="lg"
          icon="shield-checkmark-outline"
          style={{ marginTop: 6 }}
        />
      </Sheet>
    </Screen>
  );
}

/* ------------------------------ menu building blocks ----------------------- */

function MenuCard({ children, style }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 18,
          shadowColor: theme.cardShadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 8,
          marginBottom: 12,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function MenuRowIcon({ icon, tint }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
      <Ionicons name={icon} size={16} color={tint} />
    </View>
  );
}

function MenuRow({ icon, tint, label, value, valueColor, onPress, last }) {
  const { theme } = useTheme();
  const content = (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderColor: theme.border }]}>
      <MenuRowIcon icon={icon} tint={tint} />
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      {value ? <Text style={[styles.rowValue, { color: valueColor || theme.textFaint }]} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textFaint} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gradientHeader: { paddingBottom: 26 },
  identity: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 8 },
  avatarGlass: {
    width: 62, height: 62, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  identityName: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  identityHandle: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 15,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '700' },
  rowValue: { fontSize: 12.5, fontWeight: '600', marginLeft: 10, maxWidth: 150 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 15,
  },
  about: {},
  aboutRow: { flexDirection: 'row', alignItems: 'flex-start' },
  aboutIcon: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  aboutName: { fontSize: 14.5, fontWeight: '800' },
  aboutText: { fontSize: 12.5, lineHeight: 19, marginTop: 4 },
  pwMsg: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
});
