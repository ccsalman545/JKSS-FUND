// src/context/AuthContext.js
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { api } from '../api';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from '../config';

const AuthContext = createContext();
const TOKEN_KEY = 'jkss_token';
const USER_KEY = 'jkss_user';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      androidClientId: GOOGLE_ANDROID_CLIENT_ID,
      offlineAccess: false,
    });
    (async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricSupported(compatible && enrolled);
      } catch (e) { /* ignore */ }
    })();
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const [t, u] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(USER_KEY)]);
      if (t && u) {
        setToken(t);
        setUser(JSON.parse(u));
      }
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const persist = async (t, u) => {
    setToken(t); setUser(u);
    await SecureStore.setItemAsync(TOKEN_KEY, t);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(u));
  };

  const registerPush = async (t) => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      const tokenData = await Notifications.getExpoPushTokenAsync();
      await api.registerPush(t, tokenData.data);
    } catch (e) { /* ignore */ }
  };

  const login = async (username, password) => {
    const data = await api.login(username, password);
    await persist(data.token, data.user);
    registerPush(data.token);
    return data.user;
  };

  const googleLogin = async (role = 'student') => {
    await GoogleSignin.hasPlayServices();
    const { idToken } = await GoogleSignin.signIn();
    const data = await api.googleLogin(idToken, role);
    await persist(data.token, data.user);
    registerPush(data.token);
    return data.user;
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setToken(null); setUser(null);
  };

  const promptBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock JKSS Fund',
      fallbackLabel: 'Use passcode',
    });
    return result.success;
  };

  const updateProfile = async (full_name) => {
    await api.updateProfile(token, full_name);
    const updated = { ...user, full_name };
    setUser(updated);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
    return updated;
  };

  const changePassword = async (newPassword, oldPassword = '') => {
    await api.changePassword(token, oldPassword, newPassword);
  };

  const value = useMemo(
    () => ({ token, user, loading, biometricSupported, login, googleLogin, logout, promptBiometric, updateProfile, changePassword }),
    [token, user, loading, biometricSupported]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
