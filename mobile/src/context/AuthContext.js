// src/context/AuthContext.js
//
// v3.0 authentication model:
//   * Students sign in with the username the admin assigned (mapped by
//     src/identity.js to a synthetic email identifier) + password.
//   * The admin signs in with the existing Firebase Email/Password account.
//   * Google Sign-In is gone (the project never had OAuth clients configured,
//     and students must not need a Google account).
//   * A signed-in account with NO admin-pre-authorized users/{id} document is
//     held in the `unauthorized` state — it never reaches the dashboard.
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { auth } from '../firebase';
import { api } from '../api';

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
          // console / the local provisioning tool). No matching doc ->
          // "awaiting authorization" state; the dashboard stays closed.
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

  // `usernameOrEmail`: a student's assigned username, or the admin's email.
  // Nothing is stored here — Firebase Auth holds the session and
  // onAuthStateChanged re-resolves the pre-authorized profile.
  const login = async (usernameOrEmail, password) => {
    await api.login(usernameOrEmail, password);
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
    () => ({ token, user, loading, biometricSupported, unauthorized, login, logout, promptBiometric, updateProfile, changePassword }),
    [token, user, loading, biometricSupported, unauthorized]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
