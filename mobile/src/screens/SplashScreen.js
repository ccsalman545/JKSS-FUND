// src/screens/SplashScreen.js
// Branded boot screen: gradient background, pulsing logo, tagline.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { APP_NAME } from '../config';

export default function SplashScreen() {
  const { theme } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });

  return (
    <LinearGradient
      colors={theme.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
    >
      <View style={styles.deco1} />
      <View style={styles.deco2} />

      <View style={styles.center}>
        <Animated.View style={[styles.logo, { opacity: 1, transform: [{ scale }] }]}>
          <Text style={styles.logoRupee}>₹</Text>
        </Animated.View>
        <Text style={styles.name}>{APP_NAME}</Text>
        <Text style={styles.tagline}>Hostel fund, made transparent</Text>
      </View>

      <View style={styles.bottom}>
        <Text style={styles.footer}>10% committee · 90% students</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  deco1: {
    position: 'absolute', top: -90, right: -60, width: 240, height: 240,
    borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deco2: {
    position: 'absolute', bottom: -70, left: -80, width: 220, height: 220,
    borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  center: { alignItems: 'center' },
  logo: {
    width: 92, height: 92, borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 22,
  },
  logoRupee: { color: '#fff', fontSize: 44, fontWeight: '800' },
  name: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 8, fontWeight: '500' },
  bottom: { position: 'absolute', bottom: 44, alignSelf: 'stretch', alignItems: 'center' },
  footer: {
    color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    letterSpacing: 0.3,
  },
});
