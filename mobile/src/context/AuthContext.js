// src/context/AuthContext.js
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth } from '../firebase';
import { api } from '../api';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from '../config';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null); // truthy while signed in (email)
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

    const unsub = auth().onAuthStateChanged(async (fbUser) => {
      if (fbUser) {
        try { await api.ensureCommittee(); } catch (e) { /* ignore */ }
        try {
          const profile = await api.ensureProfile(fbUser, 'student');
          setUser(profile);
          setToken(fbUser.email);
        } catch (e) {
          setUser(null); setToken(null);
        }
      } else {
        setUser(null); setToken(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email, password) => {
    await api.login(email, password); // onAuthStateChanged updates state
  };

  const googleLogin = async (role = 'student') => {
    await GoogleSignin.hasPlayServices();
    const { idToken } = await GoogleSignin.signIn();
    await api.googleLogin(idToken, role);
  };

  const logout = async () => {
    await auth().signOut();
  };

  const promptBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock JKSS Fund',
      fallbackLabel: 'Use passcode',
    });
    return result.success;
  };

  const updateProfile = async (full_name) => {
    await api.updateProfile(full_name);
    const updated = { ...user, full_name };
    setUser(updated);
    return updated;
  };

  const changePassword = async (newPassword, oldPassword = '') => {
    await api.changePassword(newPassword, oldPassword);
  };

  const value = useMemo(
    () => ({ token, user, loading, biometricSupported, login, googleLogin, logout, promptBiometric, updateProfile, changePassword }),
    [token, user, loading, biometricSupported]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
