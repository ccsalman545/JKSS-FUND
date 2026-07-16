// mobile/App.js
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { palette } from './src/theme';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import StudentDashboard from './src/screens/StudentDashboard';
import TransactionsScreen from './src/screens/TransactionsScreen';
import AdminDashboard from './src/screens/AdminDashboard';
import StudentsScreen from './src/screens/StudentsScreen';
import JobsScreen from './src/screens/JobsScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ route, color, size }) {
  const map = {
    Home: 'home', History: 'list', Profile: 'person',
    Dashboard: 'grid', Students: 'people', Jobs: 'briefcase', Reports: 'bar-chart',
  };
  return <Ionicons name={map[route.name] || 'ellipsis'} size={size} color={color} />;
}

function StudentTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({ tabBarIcon: ({ color, size }) => <TabIcon route={route} color={color} size={size} /> })}
      screenOptions={{ headerShown: false, tabBarActiveTintColor: palette.primary }}>
      <Tab.Screen name="Home" component={StudentDashboard} />
      <Tab.Screen name="History" component={TransactionsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({ tabBarIcon: ({ color, size }) => <TabIcon route={route} color={color} size={size} /> })}
      screenOptions={{ headerShown: false, tabBarActiveTintColor: palette.primary }}>
      <Tab.Screen name="Dashboard" component={AdminDashboard} />
      <Tab.Screen name="Students" component={StudentsScreen} />
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function BiometricGate({ children }) {
  const { user, biometricSupported, promptBiometric } = useAuth();
  const { theme } = useTheme();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (user && biometricSupported) {
      setLocked(true);
      promptBiometric().then((ok) => { if (!ok) setLocked(true); else setLocked(false); });
    }
  }, []);

  if (!locked) return children;
  return (
    <View style={[styles.lock, { backgroundColor: theme.background }]}>
      <View style={[styles.lockCard, { backgroundColor: theme.surface }]}>
        <Text style={[styles.lockTitle, { color: theme.text }]}>🔒 App Locked</Text>
        <Text style={[styles.lockSub, { color: theme.textMuted }]}>Authenticate to continue</Text>
        <TouchableOpacity style={[styles.lockBtn, { backgroundColor: palette.primary }]} onPress={async () => {
          const ok = await promptBiometric();
          if (ok) setLocked(false);
        }}>
          <Text style={styles.lockBtnText}>Unlock with Biometrics</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Root() {
  const { user, loading, logout } = useAuth();
  const { theme } = useTheme();

  if (loading) return <SplashScreen />;
  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }
  return (
    <BiometricGate>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user.role === 'admin'
          ? <Stack.Screen name="Admin" component={AdminTabs} />
          : <Stack.Screen name="Student" component={StudentTabs} />}
      </Stack.Navigator>
    </BiometricGate>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  lockCard: { width: '100%', borderRadius: 20, padding: 28, alignItems: 'center', elevation: 4 },
  lockTitle: { fontSize: 22, fontWeight: '800' },
  lockSub: { fontSize: 14, marginVertical: 8 },
  lockBtn: { paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, marginTop: 12 },
  lockBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
