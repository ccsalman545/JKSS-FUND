// src/screens/ProfileScreen.js
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Screen, Card, Button, Subtitle, Input, Title } from '../components/ui';
import { formatINR, initials } from '../utils/format';
import { palette, APP_NAME } from '../config';
// changePassword is provided by AuthContext

export default function ProfileScreen() {
  const { user, logout, updateProfile, biometricSupported, changePassword } = useAuth();
  const { theme, isDark, toggle } = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.full_name || '');
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    setSaving(true);
    try { await updateProfile(name.trim()); setEditing(false); }
    catch (e) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const onChangePw = () => {
    Alert.prompt('Change password', 'Enter your CURRENT password', async (old) => {
      if (!old) return;
      Alert.prompt('Change password', 'Enter your NEW password', async (value) => {
        if (!value) return;
        try { await changePassword(value, old); Alert.alert('Success', 'Password updated'); }
        catch (e) { Alert.alert('Error', e.message); }
      });
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
          <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
        </View>
        <View style={{ marginLeft: 14 }}>
          <Title>{user?.full_name}</Title>
          <Subtitle>@{user?.username} · {user?.role}</Subtitle>
        </View>
      </View>

      {editing ? (
        <Card>
          <Input placeholder="Full name" value={name} onChangeText={setName} />
          <Button label={saving ? 'Saving…' : 'Save'} loading={saving} onPress={saveName} />
          <Button label="Cancel" variant="outline" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <Button label="Edit Name" variant="outline" onPress={() => setEditing(true)} />
      )}

      {user?.role === 'admin' ? (
        <Button label="Change Password" variant="outline" onPress={onChangePw} />
      ) : null}

      <Card style={styles.row}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>Dark Mode</Text>
        <Switch value={isDark} onValueChange={toggle} thumbColor={isDark ? palette.accent : '#fff'} />
      </Card>

      <Card style={styles.row}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>Biometric Lock</Text>
        <Text style={[styles.rowValue, { color: biometricSupported ? palette.success : theme.textMuted }]}>
          {biometricSupported ? 'Supported' : 'Not available'}
        </Text>
      </Card>

      <Card>
        <Text style={[styles.about, { color: theme.textMuted }]}>
          {APP_NAME} v2.0 — transparent hostel fund management.{'\n'}10% to committee, 90% split equally among students.
        </Text>
      </Card>

      <Button label="Logout" variant="danger" onPress={logout} />
    </Screen>
  );
}
