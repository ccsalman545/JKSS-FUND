// src/screens/SplashScreen.js
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { palette } from '../theme';

export default function SplashScreen() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator size="large" color={palette.primary} />
    </View>
  );
}
