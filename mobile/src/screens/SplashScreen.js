// src/screens/SplashScreen.js
// Cinematic boot screen: gradient background, logo scale-in, staggered text.
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { APP_NAME } from '../config';

export default function SplashScreen() {
  const { theme } = useTheme();
  const logo = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Cinematic: logo scales up from 0.82, then title + tagline slide in.
    Animated.stagger(140, [
      Animated.spring(logo, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 60,
      }),
      Animated.timing(title, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sub, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const logoScale = logo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const logoOpacity = logo.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const titleOpacity = title;
  const titleY = title.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const subOpacity = sub;
  const subY = sub.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

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
        <Animated.View style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <Text style={styles.logoRupee}>₹</Text>
        </Animated.View>
        <Animated.View style={{ opacity: titleOpacity, transform: [{ translateY: titleY }] }}>
          <Text style={styles.name}>{APP_NAME}</Text>
        </Animated.View>
        <Animated.View style={{ opacity: subOpacity, transform: [{ translateY: subY }] }}>
          <Text style={styles.tagline}>Hostel fund, made transparent</Text>
        </Animated.View>
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
    width: 96, height: 96, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  logoRupee: { color: '#fff', fontSize: 46, fontWeight: '800' },
  name: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: 'rgba(255,255,255,0.8)', fontSize: 14.5, marginTop: 8, fontWeight: '500' },
  bottom: { position: 'absolute', bottom: 44, alignSelf: 'stretch', alignItems: 'center' },
  footer: {
    color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    letterSpacing: 0.3,
  },
});
