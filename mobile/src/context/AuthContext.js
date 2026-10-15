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
  // Signed in but NO pre-authorized profile doc (students must be
  // pre-authorized by the admin; see ensureProfile).
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    // Only configure Google Sign-In with real OAuth client IDs — placeholder
    // IDs would make the native library throw/misbehave at configure time.
    // Email/password auth is unaffected.
    if (GOOGLE_SIGNIN_CONFIGURED) {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        androidClientId: GOOGLE_ANDROID_CLIENT_ID,
        offlineAccess: false,
      });
    }
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
          // Read-only: profiles are pre-authorized by the admin (or the
          // console). No matching doc -> "not pre-authorized" state.
          const profile = await api.ensureProfile(fbUser);
          if (profile) {
            setUser(profile);
            setUnauthorized(false);
          } else {
            setUser(null);
            setUnauthorized(true);
          }
          setToken(fbUser.email);
        } catch (e) {
          setUser(null); setToken(null); setUnauthorized(false);
        }
      } else {
        setUser(null); setToken(null); setUnauthorized(false);
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
    () => ({ token, user, loading, biometricSupported, unauthorized, login, googleLogin, logout, promptBiometric, updateProfile, changePassword }),
    [token, user, loading, biometricSupported, unauthorized]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
