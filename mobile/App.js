// mobile/App.js
// Root navigation: splash → login → role-based tabs (student / admin).
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'react-native-linear-gradient';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { palette, radius } from './src/theme';
import { APP_NAME } from './src/config';
import { Button } from './src/components/ui';

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

const TAB_ICONS = {
  Home: ['home', 'home-outline'],
  History: ['receipt', 'receipt-outline'],
  Profile: ['person', 'person-outline'],
  Dashboard: ['grid', 'grid-outline'],
  Students: ['people', 'people-outline'],
  Jobs: ['briefcase', 'briefcase-outline'],
  Reports: ['bar-chart', 'bar-chart-outline'],
};

const TabIcon = ({ route, focused, color }) => {
  const [solid, outline] = TAB_ICONS[route.name] || ['ellipse', 'ellipse-outline'];
  return <Ionicons name={focused ? solid : outline} size={22} color={color} />;
};

function useTabOptions() {
  const { theme } = useTheme();
  return ({ route }) => ({
    headerShown: false,
    tabBarIcon: ({ color }) => <TabIcon route={route} focused={color === palette.primary} color={color} />,
    tabBarActiveTintColor: palette.primary,
    tabBarInactiveTintColor: theme.textFaint,
    tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
    tabBarStyle: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 10,
      height: 60,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: theme.tabBar,
      borderTopWidth: 0,
      elevation: 14,
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: theme.mode === 'dark' ? 0.5 : 0.16,
      shadowRadius: 18,
    },
  });
}

function StudentTabs() {
  const options = useTabOptions();
  return (
    <Tab.Navigator screenOptions={options}>
      <Tab.Screen name="Home" component={StudentDashboard} />
      <Tab.Screen name="History" component={TransactionsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AdminTabs() {
  const options = useTabOptions();
  return (
    <Tab.Navigator screenOptions={options}>
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
      promptBiometric().then((ok) => setLocked(!ok));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!locked) return children;

  return (
    <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.lockWrap}>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 }}>
        <View style={styles.lockGlass}>
          <View style={styles.lockIconWrap}>
            <Ionicons name="finger-print" size={34} color="#fff" />
          </View>
          <Text style={styles.lockTitle}>App locked</Text>
          <Text style={styles.lockSub}>Authenticate to open {APP_NAME}</Text>
          <Pressable
            style={({ pressed }) => [styles.lockBtn, pressed && { opacity: 0.85 }]}
            onPress={async () => {
              const ok = await promptBiometric();
              if (ok) setLocked(false);
            }}
          >
            <View style={styles.lockBtnInner}>
              <Ionicons name="unlock-outline" size={17} color={palette.primaryDark} />
              <Text style={styles.lockBtnText}>Unlock</Text>
            </View>
          </Pressable>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) return <SplashScreen />;
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <BiometricGate>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {user.role === 'admin' ? (
            <Stack.Screen name="Admin" component={AdminTabs} />
          ) : (
            <Stack.Screen name="Student" component={StudentTabs} />
          )}
        </Stack.Navigator>
      </BiometricGate>
    </View>
  );
}

function Shell() {
  const { isDark } = useTheme();
  return (
    <NavigationContainer>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  lockWrap: { flex: 1 },
  lockGlass: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 30,
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  lockIconWrap: {
    width: 64, height: 64, borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  lockTitle: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  lockSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, marginTop: 6, textAlign: 'center' },
  lockBtn: { marginTop: 20, backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: 4, paddingHorizontal: 6 },
  lockBtnInner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 26 },
  lockBtnText: { color: palette.primaryDark, fontWeight: '800', fontSize: 15, marginLeft: 8 },
});
