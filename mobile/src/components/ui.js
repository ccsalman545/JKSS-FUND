// src/components/ui.js
// "Aurora M3" design system — Material 3 tonal building blocks,
// readable type scale, cinematic entrances, M3 state layers + ripples.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Animated, Easing,
  StyleSheet, Dimensions, KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { radius } from '../theme';
import { initials, formatDateTime, formatINR } from '../utils/format';

const { height: SCREEN_H } = Dimensions.get('window');

/* ---------------------------------- layout --------------------------------- */

export const Screen = ({ children, style, noPad }) => {
  const { theme } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: theme.background }, !noPad && { padding: 16 }, style]}>
      {children}
    </View>
  );
};

export const Card = ({ children, style, noPad }) => {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius.md,
          borderWidth: 1,
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.cardShadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 8,
          elevation: theme.mode === 'dark' ? 0 : 2,
        },
        !noPad && { padding: 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
};

export const GradientCard = ({ children, colors, start, end, style }) => {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={colors || theme.gradient}
      start={start || { x: 0, y: 0 }}
      end={end || { x: 1, y: 1 }}
      style={[
        {
          borderRadius: radius.xl,
          overflow: 'hidden',
          shadowColor: 'rgba(79, 70, 229, 0.35)',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 1,
          shadowRadius: 18,
          elevation: 6,
        },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
};

export const Header = ({ title, subtitle, right, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }, style]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.3, color: theme.text }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 13.5, marginTop: 3, color: theme.textMuted }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
};

export const SectionHeader = ({ title, action, onAction, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10 }, style]}>
      <Text style={{ fontSize: 17, fontWeight: '800', letterSpacing: -0.2, color: theme.text }}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} android_ripple={{ color: theme.ripple }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.primary }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

export const Divider = ({ style }) => {
  const { theme } = useTheme();
  return <View style={[{ height: 1, marginVertical: 10, backgroundColor: theme.border }, style]} />;
};

export const Badge = ({ children, color = 'primary', style }) => {
  const { theme } = useTheme();
  const c = color === 'primary' ? theme.primary : color;
  const bg = color === 'primary' ? theme.primarySoft : color + '1A';
  return (
    <View style={[{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start', backgroundColor: bg }, style]}>
      <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: c }}>{children}</Text>
    </View>
  );
};

/* --------------------------------- avatar ---------------------------------- */

export const Avatar = ({ name = '', size = 44, style }) => {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={theme.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          width: size, height: size, borderRadius: size / 2,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: 'rgba(79, 70, 229, 0.35)',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 1, shadowRadius: 8,
          elevation: 4,
        },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36, letterSpacing: 0.5 }}>
        {initials(name) || '?'}
      </Text>
    </LinearGradient>
  );
};

/* ------------------------------ cinematic fade ----------------------------- */

export const FadeIn = ({ navigation, delay = 0, children, style }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      opacity.setValue(0);
      translateY.setValue(18);
      Animated.stagger(delay, [
        Animated.timing(opacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          friction: 14,
          tension: 110,
        }),
      ]).start();
    };
    if (navigation) {
      const unsub = navigation.addListener('focus', run);
      return unsub;
    }
    const id = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, delay]);

  return (
    <Animated.View style={[{ flex: 1, opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
};

/* --------------------------------- buttons --------------------------------- */

const BUTTON_SIZES = {
  sm: { padY: 9, padX: 18, fontSize: 13.5, icon: 16 },
  md: { padY: 12, padX: 24, fontSize: 15.5, icon: 18 },
  lg: { padY: 14, padX: 28, fontSize: 16.5, icon: 20 },
};

export const Button = ({
  label, onPress, variant = 'primary', icon, loading, disabled,
  size = 'md', style,
}) => {
  const { theme } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const s = BUTTON_SIZES[size];

  const animateTo = (v) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, friction: 7, tension: 150 }).start();

  let isGradient = false;
  let colors = null;
  let bg = theme.surface;
  let fg = theme.text;
  switch (variant) {
    case 'accent':
      isGradient = true;
      colors = theme.gradientAccent;
      fg = '#fff';
      break;
    case 'soft':
    case 'container':
      bg = theme.primarySoft;
      fg = theme.onPrimaryContainer;
      break;
    case 'softAccent':
      bg = theme.accentSoft;
      fg = theme.accent;
      break;
    case 'outline':
      bg = theme.surface;
      fg = theme.text;
      break;
    case 'ghost':
      bg = 'transparent';
      fg = theme.text;
      break;
    case 'danger':
      bg = theme.dangerSoft;
      fg = theme.danger;
      break;
    case 'primary':
    default:
      isGradient = true;
      colors = theme.gradient;
      fg = theme.onPrimary;
      break;
  }

  const outline = variant === 'outline' ? { borderWidth: 1, borderColor: theme.outline } : {};
  const shadow = isGradient
    ? {
        shadowColor: variant === 'accent' ? 'rgba(249, 115, 22, 0.35)' : 'rgba(79, 70, 229, 0.35)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 5,
      }
    : {};

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        icon ? <Ionicons name={icon} size={s.icon} color={fg} /> : null
      )}
      <Text
        style={{
          color: fg,
          fontWeight: '700',
          fontSize: s.fontSize,
          letterSpacing: 0.2,
          marginLeft: loading ? 10 : icon ? 8 : 0,
        }}
      >
        {label}
      </Text>
    </>
  );

  const body = (pressed) => {
    const base = {
      borderRadius: radius.pill,
      paddingVertical: s.padY,
      paddingHorizontal: s.padX,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      opacity: disabled || loading ? 0.55 : pressed ? 0.92 : 1,
    };
    if (isGradient) {
      return (
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[base, shadow]}
        >
          {content}
        </LinearGradient>
      );
    }
    return (
      <View style={[base, { backgroundColor: bg }, outline, shadow]}>
        {content}
      </View>
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => animateTo(0.97)}
      onPressOut={() => animateTo(1)}
      android_ripple={{ color: theme.ripple, borderless: true }}
      style={style}
    >
      {(pressed) => <Animated.View style={{ transform: [{ scale }] }}>{body(pressed)}</Animated.View>}
    </Pressable>
  );
};

export const IconButton = ({ icon, onPress, size = 38, tint, bg, style, disabled }) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      activeOpacity={0.8}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg || (tint ? tint + '14' : 'transparent'),
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={tint || theme.textMuted} />
    </TouchableOpacity>
  );
};

/* ---------------------------------- input ---------------------------------- */

export const Input = ({
  placeholder, value, onChangeText, secure, keyboardType, icon, label,
  error, prefix, style, labelStyle, ...rest
}) => {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.danger : focused ? theme.primary : theme.border;

  return (
    <View style={style}>
      {label ? (
        <Text style={[{ fontSize: 13.5, fontWeight: '700', marginBottom: 7, letterSpacing: 0.2, color: theme.textMuted }, labelStyle]}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: radius.sm,
            paddingHorizontal: 14,
            backgroundColor: theme.surfaceAlt,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            marginBottom: 14,
            shadowColor: focused ? 'rgba(90, 91, 214, 0.25)' : 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 8,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={focused ? theme.primary : theme.textFaint}
            style={{ marginRight: 10 }}
          />
        ) : null}
        {prefix ? (
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, marginRight: 8 }}>{prefix}</Text>
        ) : null}
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={theme.textFaint}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          onFocus={() => setFocused(true)}
          onEndEditing={() => setFocused(false)}
          style={{ flex: 1, paddingVertical: 13, fontSize: 16, color: theme.text }}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={{ fontSize: 12.5, marginTop: -8, marginBottom: 10, marginLeft: 4, fontWeight: '600', color: theme.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

/* ------------------------------- segmented --------------------------------- */

export const Segmented = ({ options, value, onChange, style }) => {
  const { theme } = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const pos = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (w > 0) {
      Animated.spring(pos, {
        toValue: idx * (w / options.length),
        useNativeDriver: true,
        friction: 26,
        tension: 170,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, w]);

  const segW = w / options.length;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          padding: 4,
          borderRadius: radius.pill,
          backgroundColor: theme.surfaceContainer,
          borderWidth: 1,
          borderColor: theme.border,
        },
        style,
      ]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      pointerEvents={w > 0 ? 'auto' : 'none'}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            backgroundColor: theme.secondaryContainer,
            width: segW > 0 ? segW - 6 : 0,
            borderRadius: radius.pill,
            shadowColor: 'rgba(15, 23, 42, 0.12)',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 1,
            shadowRadius: 5,
            elevation: 3,
            transform: [{ translateX: pos }],
          },
        ]}
      />
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}
          onPress={() => onChange(o.value)}
          activeOpacity={0.8}
        >
          <Text
            style={{
              fontSize: 14,
              letterSpacing: 0.2,
              color: o.value === value ? theme.onSecondaryContainer : theme.textMuted,
              fontWeight: o.value === value ? '700' : '500',
            }}
          >
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

export const Chip = ({ label, active, onPress, icon, style }) => {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.ripple, borderless: true }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 9,
          borderRadius: radius.pill,
          borderWidth: 1,
          marginRight: 8,
          backgroundColor: active ? theme.primary : theme.surfaceContainerHigh,
          borderColor: active ? theme.primary : theme.border,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={14} color={active ? theme.onPrimary : theme.textMuted} style={{ marginRight: 5 }} />
      ) : null}
      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? theme.onPrimary : theme.textMuted }}>{label}</Text>
    </Pressable>
  );
};

/* ------------------------------- stat / rows ------------------------------- */

export const StatTile = ({ icon, label, value, tint, valueColor, style, iconSize = 36 }) => {
  const { theme } = useTheme();
  return (
    <Card style={style}>
      <View style={[{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 12, backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={Math.round(iconSize * 0.5)} color={tint} />
      </View>
      <Text style={{ fontSize: 21, fontWeight: '800', letterSpacing: -0.3, color: valueColor || theme.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ fontSize: 13, marginTop: 3, fontWeight: '600', color: theme.textMuted }} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
};

export const TxnRow = ({ txn, style, last }) => {
  const { theme } = useTheme();
  const earning = txn.type === 'earning';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 13,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderRadius: radius.md,
          marginBottom: 8,
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderBottomWidth: last ? 0 : 1,
          shadowColor: theme.cardShadow,
          elevation: theme.mode === 'dark' ? 0 : 1,
        },
        style,
      ]}
    >
      <View style={[{ width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: earning ? theme.successSoft : theme.dangerSoft }]}>
        <Ionicons name={earning ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={earning ? theme.success : theme.danger} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text }} numberOfLines={1}>
          {txn.description || txn.type}
        </Text>
        <Text style={{ fontSize: 12, marginTop: 3, color: theme.textFaint }}>
          {formatDateTime(txn.createdAt)}
        </Text>
      </View>
      <Text style={{ fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2, color: earning ? theme.success : theme.danger }}>
        {earning ? '+' : '-'}{formatINR(txn.amount)}
      </Text>
    </View>
  );
};

/* -------------------------------- empty state ------------------------------ */

export const EmptyState = ({ icon = 'file-tray-outline', title, subtitle, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[{ alignItems: 'center', marginTop: 48, paddingHorizontal: 32 }, style]}>
      <View style={[{ width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16, backgroundColor: theme.surfaceContainer }]}>
        <Ionicons name={icon} size={30} color={theme.textFaint} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '800', color: theme.text }}>{title}</Text>
      {subtitle ? (
        <Text style={{ fontSize: 13.5, textAlign: 'center', marginTop: 6, lineHeight: 21, color: theme.textMuted }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
};

/* ----------------------------- bottom sheet -------------------------------- */

export const Sheet = ({ visible, onClose, title, children, style }) => {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 15, tension: 100 }),
          Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      });
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: 1, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_H * 1.5] });

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay, opacity: fade }]}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onClose}
        />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={[
              {
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                backgroundColor: theme.surface,
                paddingBottom: Platform.OS === 'ios' ? 34 : 24,
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.15,
                shadowRadius: 20,
                elevation: 24,
              },
              { transform: [{ translateY }] },
              style,
            ]}
          >
            <View style={{ alignItems: 'center', marginTop: 10, marginBottom: 4 }}>
              <View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: theme.border }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 10 }}>
              {title ? (
                <Text style={{ flex: 1, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: theme.text }}>{title}</Text>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              {title ? <View style={{ flex: 1 }} /> : null}
              <IconButton icon="close" onPress={onClose} size={34} style={{ marginRight: 12 }} />
            </View>
            <View style={{ paddingHorizontal: 20 }}>{children}</View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export const ConfirmSheet = ({
  visible, onClose, onConfirm, title = 'Are you sure?', message,
  confirmLabel = 'Confirm', destructive = true, loading,
}) => {
  const { theme } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {message ? (
        <Text style={{ color: theme.textMuted, marginBottom: 18, fontSize: 14.5, lineHeight: 22 }}>{message}</Text>
      ) : null}
      <Button
        label={loading ? 'Working…' : confirmLabel}
        loading={loading}
        onPress={onConfirm}
        variant={destructive ? 'danger' : 'primary'}
        size="lg"
        icon={destructive ? 'trash-outline' : 'checkmark-circle-outline'}
        style={{ marginBottom: 8 }}
      />
      <Button label="Cancel" variant="outline" size="lg" onPress={onClose} />
    </Sheet>
  );
};

/* ------------------------------ text helpers ------------------------------- */

export const Title = ({ children, style }) => {
  const { theme } = useTheme();
  return <Text style={[{ fontSize: 24, fontWeight: '800', letterSpacing: -0.3, color: theme.text }, style]}>{children}</Text>;
};

export const Subtitle = ({ children, style }) => {
  const { theme } = useTheme();
  return <Text style={[{ fontSize: 14, marginTop: 2, color: theme.textMuted }, style]}>{children}</Text>;
};

export const StatCard = ({ label, value, color, style }) => {
  const { theme } = useTheme();
  return <StatTile icon="wallet-outline" label={label} value={value} tint={color || theme.primary} valueColor={color} style={style} />;
};
