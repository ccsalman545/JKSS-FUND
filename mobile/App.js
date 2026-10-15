// mobile/App.js
// Root navigation: splash → login → role-based tabs (student / admin).
// Bottom tabs render as a Material 3 navigation bar with an animated
// tonal indicator pill (M3 NavigationBar spec: 64×32 secondaryContainer).
import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'react-native-linear-gradient';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { radius } from './src/theme';
import { APP_NAME } from './src/config';

import SplashScreen from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import NotAuthorizedScreen from './src/screens/NotAuthorizedScreen';
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

/* ---------------------- Material 3 navigation bar -------------------------- */

function M3TabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const count = Math.max(1, state.routes.length);
  const idx = state.index;
  const pos = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (w > 0) {
      Animated.spring(pos, {
        toValue: idx * (w / count),
        useNativeDriver: true,
        friction: 28,
        tension: 200,
      }).start();
    }
  }, [idx, w, count]);

  const segW = w / count;

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{
        backgroundColor: theme.tabBar,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        height: 78 + insets.bottom,
        elevation: 12,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: theme.mode === 'dark' ? 0.5 : 0.14,
        shadowRadius: 16,
      }}
    >
      <View style={{ flexDirection: 'row', flex: 1 }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 6,
              width: 64,
              height: 32,
              borderRadius: radius.pill,
              backgroundColor: theme.secondaryContainer,
              transform: [{ translateX: pos }],
            },
          ]}
        />
        {state.routes.map((route, i) => {
          const active = i === idx;
          const [solid, outline] = TAB_ICONS[route.name] || ['ellipse', 'ellipse-outline'];
          return (
            <Pressable
              key={route.key}
              style={{ flex: 1 }}
              android_ripple={{ color: theme.ripple, borderless: true }}
              onPress={() => navigation.navigate(route.name)}
            >
              <View style={{ width: 64, height: 32, marginTop: 6, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons
                  name={active ? solid : outline}
                  size={22}
                  color={active ? theme.onSecondaryContainer : theme.textMuted}
                />
              </View>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: active ? '700' : '500',
                  letterSpacing: 0.2,
                  color: active ? theme.onSecondaryContainer : theme.textMuted,
                  marginTop: 6,
                  marginBottom: 10,
                }}
              >
                {route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------ tab screens ------------------------------- */

function StudentTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBar: M3TabBar }}>
      <Tab.Screen name="Home" component={StudentDashboard} />
      <Tab.Screen name="History" component={TransactionsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBar: M3TabBar }}>
      <Tab.Screen name="Dashboard" component={AdminDashboard} />
      <Tab.Screen name="Students" component={StudentsScreen} />
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

/* ---------------------------- biometric gate ------------------------------ */

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
    <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
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
              <Ionicons name="unlock-outline" size={17} color={theme.mode === 'dark' ? '#DCD9FF' : '#1A1468'} />
              <Text style={[styles.lockBtnText, { color: theme.mode === 'dark' ? '#DCD9FF' : '#1A1468' }]}>Unlock</Text>
            </View>
          </Pressable>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Root() {
  const { user, loading, unauthorized } = useAuth();
  const { theme } = useTheme();

  if (loading) return <SplashScreen />;
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {/* Signed in but NOT pre-authorized by the admin → the only screen
              the session can reach (no dashboard, no balances, no writes). */}
          {unauthorized
            ? <Stack.Screen name="NotAuthorized" component={NotAuthorizedScreen} />
            : <Stack.Screen name="Login" component={LoginScreen} />}
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
  notAuthRoot: { flex: 1 },
  lockGlass: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: 30,
    alignItems: 'center',
  },
  lockIconWrap: {
    width: 64, height: 64, borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  lockTitle: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  lockSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  lockBtn: { marginTop: 20, backgroundColor: '#fff', borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 6 },
  lockBtnInner: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 28 },
  lockBtnText: { fontWeight: '800', fontSize: 15, marginLeft: 8 },
});
