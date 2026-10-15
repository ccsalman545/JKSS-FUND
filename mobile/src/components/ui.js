// src/components/ui.js
// "Aurora" design system — shared, theme-aware UI building blocks.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, Animated,
  StyleSheet, Dimensions, KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'react-native-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { palette, radius } from '../theme';
import { initials, formatDateTime, formatINR } from '../utils/format';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.cardShadow,
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
      style={[styles.gradientCard, { shadowColor: 'rgba(79, 70, 229, 0.35)' }, style]}
    >
      {children}
    </LinearGradient>
  );
};

export const Header = ({ title, subtitle, right, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.headerRow, style]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.headerSub, { color: theme.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
};

export const SectionHeader = ({ title, action, onAction, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.sectionRow, style]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: palette.primary }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export const Divider = ({ style }) => {
  const { theme } = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }, style]} />;
};

export const Badge = ({ children, color = palette.primary, bg, style }) => {
  return (
    <View style={[styles.badge, { backgroundColor: bg || (color + '1A') }, style]}>
      <Text style={[styles.badgeText, { color }]}>{children}</Text>
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
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', shadowColor: 'rgba(79,70,229,0.35)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36, letterSpacing: 0.5 }}>
        {initials(name) || '?'}
      </Text>
    </LinearGradient>
  );
};

/* --------------------------------- buttons --------------------------------- */

const BUTTON_VARIANTS = {
  primary: { fg: '#FFFFFF', icon: '#FFFFFF' },
  accent: { fg: '#FFFFFF', icon: '#FFFFFF' },
  soft: { bg: null, fg: null }, // theme-aware, filled below
  softAccent: { bg: palette.accentSoft, fg: '#B45309' },
  outline: { bg: null, fg: null },
  ghost: { bg: 'transparent', fg: null },
  danger: { bg: null, fg: null },
};

export const Button = ({
  label, onPress, variant = 'primary', icon, loading, disabled,
  size = 'md', style,
}) => {
  const { theme } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const sizes = {
    sm: { pad: 9, radius: 12, fontSize: 13, icon: 15 },
    md: { pad: 14, radius: 14, fontSize: 15, icon: 18 },
    lg: { pad: 16, radius: 16, fontSize: 16, icon: 20 },
  }[size];

  const animateTo = (v) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, friction: 7, tension: 140 }).start();

  let bg = null;
  let fg = theme.text;
  let isGradient = false;
  switch (variant) {
    case 'primary':
      isGradient = true;
      fg = '#fff';
      break;
    case 'accent':
      isGradient = true;
      fg = '#fff';
      break;
    case 'soft':
      bg = theme.mode === 'dark' ? 'rgba(99, 102, 241, 0.18)' : palette.primarySoft;
      fg = theme.mode === 'dark' ? '#A5B4FC' : palette.primaryDark;
      break;
    case 'softAccent':
      bg = palette.accentSoft;
      fg = theme.mode === 'dark' ? '#FBBF24' : '#B45309';
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
      bg = theme.mode === 'dark' ? 'rgba(244, 63, 94, 0.16)' : palette.dangerSoft;
      fg = theme.mode === 'dark' ? '#FB7185' : palette.danger;
      break;
    default:
      isGradient = true;
      fg = '#fff';
  }

  const iconColor = fg;

  const body = (pressed) => {
    const base = {
      borderRadius: sizes.radius,
      paddingVertical: sizes.pad,
      paddingHorizontal: sizes.pad * 1.6,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      opacity: (disabled || loading) ? 0.55 : pressed ? 0.9 : 1,
    };
    if (isGradient) {
      const colors = variant === 'accent' ? theme.gradientAccent : theme.gradient;
      return (
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[base, { shadowColor: variant === 'accent' ? 'rgba(249,115,22,0.35)' : 'rgba(79,70,229,0.35)', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 10, elevation: 5 }]}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: '#fff', marginLeft: 8, fontWeight: '700', fontSize: sizes.fontSize }}>{label}</Text>
            </View>
          ) : (
            <Row icon={icon} iconColor={iconColor} label={label} fg={fg} fontSize={sizes.fontSize} />
          )}
        </LinearGradient>
      );
    }
    return (
      <View style={[base, { backgroundColor: bg, ...(variant === 'outline' ? { borderWidth: 1, borderColor: theme.border } : {}) }]}>
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator color={fg} />
            <Text style={{ color: fg, marginLeft: 8, fontWeight: '700', fontSize: sizes.fontSize }}>{label}</Text>
          </View>
        ) : (
          <Row icon={icon} iconColor={iconColor} label={label} fg={fg} fontSize={sizes.fontSize} />
        )}
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
      style={style}
    >
      {(pressed) => (
        <Animated.View style={{ transform: [{ scale }] }}>{body(pressed)}</Animated.View>
      )}
    </Pressable>
  );
};

function Row({ icon, iconColor, label, fg, fontSize }) {
  return (
    <>
      {icon ? (
        <Ionicons name={icon} size={18} color={iconColor} style={{ marginRight: 8 }} />
      ) : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize, letterSpacing: 0.2 }}>{label}</Text>
    </>
  );
}

export const IconButton = ({ icon, onPress, size = 38, tint, bg, style, disabled }) => {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      activeOpacity={0.7}
      style={[
        {
          width: size, height: size, borderRadius: size / 2,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: bg || (tint ? tint + '14' : theme.surfaceAlt),
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.46} color={tint || theme.textMuted} />
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
  const borderColor = error ? palette.danger : focused ? palette.primary : theme.border;

  return (
    <View style={style}>
      {label ? (
        <Text style={[styles.inputLabel, { color: theme.textMuted }, labelStyle]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: theme.surfaceAlt,
            borderColor,
            borderWidth: focused || error ? 1.5 : 1,
            shadowColor: focused ? 'rgba(99,102,241,0.25)' : 'transparent',
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
            color={focused ? palette.primary : theme.textFaint}
            style={{ marginRight: 10 }}
          />
        ) : null}
        {prefix ? <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, marginRight: 8 }}>{prefix}</Text> : null}
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={theme.textFaint}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          onFocus={() => setFocused(true)}
          onEndEditing={() => setFocused(false)}
          style={[styles.input, { color: theme.text }]}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={[styles.inputError, { color: palette.danger }]}>{error}</Text>
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
      Animated.spring(pos, { toValue: idx * (w / options.length), useNativeDriver: true, friction: 24, tension: 160 }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, w]);

  const segW = w / options.length;

  return (
    <View
      style={[styles.seg, { backgroundColor: theme.surfaceAlt, borderRadius: radius.md }, style]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      pointerEvents={w > 0 ? 'auto' : 'none'}
    >
      <Animated.View
        style={[
          styles.segThumb,
          {
            backgroundColor: theme.surface,
            width: segW > 0 ? segW - 6 : 0,
            borderRadius: radius.md - 3,
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
        <TouchableOpacity key={o.value} style={styles.segItem} onPress={() => onChange(o.value)} activeOpacity={0.7}>
          <Text
            style={[
              styles.segText,
              { color: o.value === value ? theme.text : theme.textMuted, fontWeight: o.value === value ? '700' : '500' },
            ]}
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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        {
          backgroundColor: active ? palette.primary : theme.surfaceAlt,
          borderColor: active ? palette.primary : theme.border,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? '#fff' : theme.textMuted} style={{ marginRight: 5 }} /> : null}
      <Text style={{ color: active ? '#fff' : theme.textMuted, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
    </TouchableOpacity>
  );
};

/* ------------------------------- stat / rows ------------------------------- */

export const StatTile = ({ icon, label, value, tint = palette.primary, valueColor, style, iconSize = 36 }) => {
  const { theme } = useTheme();
  return (
    <Card style={style}>
      <View style={[styles.statIconBubble, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={iconSize * 0.5} color={tint} />
      </View>
      <Text style={[styles.statValue, { color: valueColor || theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]} numberOfLines={1}>{label}</Text>
    </Card>
  );
};

export const TxnRow = ({ txn, style, last }) => {
  const { theme } = useTheme();
  const earning = txn.type === 'earning';
  return (
    <View
      style={[
        styles.txnRow,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderBottomWidth: last ? 0 : 1,
          shadowColor: theme.cardShadow,
          elevation: theme.mode === 'dark' ? 0 : 1,
        },
        style,
      ]}
    >
      <View style={[styles.txnIcon, { backgroundColor: earning ? palette.successSoft : palette.dangerSoft }]}>
        <Ionicons name={earning ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={earning ? palette.success : palette.danger} />
      </View>
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={[styles.txnDesc, { color: theme.text }]} numberOfLines={1}>{txn.description || txn.type}</Text>
        <Text style={[styles.txnDate, { color: theme.textFaint }]}>
          {formatDateTime(txn.createdAt)}
        </Text>
      </View>
      <Text style={[styles.txnAmt, { color: earning ? palette.success : palette.danger }]}>
        {earning ? '+' : '-'}{formatINR(txn.amount)}
      </Text>
    </View>
  );
};


/* -------------------------------- empty state ------------------------------ */

export const EmptyState = ({ icon = 'file-tray-outline', title, subtitle, style }) => {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, style]}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceAlt }]}>
        <Ionicons name={icon} size={30} color={theme.textFaint} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.emptySub, { color: theme.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
};

/* -------------------------------- split bar -------------------------------- */

export const SplitBar = ({ committee = 10, student = 90, style, height = 10 }) => {
  const { theme } = useTheme();
  return (
    <View style={style}>
      <View style={[styles.splitTrack, { backgroundColor: theme.surfaceAlt, height, borderRadius: height / 2 }]}>
        <View
          style={{
            width: `${(committee / (committee + student)) * 100}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: palette.accent,
          }}
        />
      </View>
      <View style={[styles.splitLegend, { borderTopColor: theme.border, marginTop: 10 }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: palette.accent }]} />
          <Text style={[styles.legendText, { color: theme.textMuted }]}>{committee}% committee fund</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: palette.primary }]} />
          <Text style={[styles.legendText, { color: theme.textMuted }]}>{student}% to students</Text>
        </View>
      </View>
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
          Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 14, tension: 110 }),
          Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      });
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: 1, duration: 170, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 170, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_H * 1.5] });

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay, opacity: fade }]}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onClose}
        />
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={[
              {
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
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
              {title ? <Text style={[styles.sheetTitle, { color: theme.text }]} style={{ flex: 1 }}>{title}</Text> : null}
              {title ? <View style={{ flex: 1 }} /> : null}
              <IconButton icon="close" onPress={onClose} size={32} style={{ marginRight: 12 }} />
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
        <Text style={[styles.confirmMsg, { color: theme.textMuted, marginBottom: 18 }]}>{message}</Text>
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
  return <Text style={[styles.title, { color: theme.text }, style]}>{children}</Text>;
};

export const Subtitle = ({ children, style }) => {
  const { theme } = useTheme();
  return <Text style={[styles.subtitle, { color: theme.textMuted }, style]}>{children}</Text>;
};

export const StatCard = ({ label, value, color, style }) => (
  <StatTile icon="wallet-outline" label={label} value={value} tint={color || palette.primary} valueColor={color} style={style} />
);

/* --------------------------------- styles ---------------------------------- */

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  gradientCard: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 6,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { fontSize: 13, marginTop: 2 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  sectionAction: { fontSize: 13, fontWeight: '700' },
  divider: { height: 1, marginVertical: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4 },

  buttonBase: { alignItems: 'center', justifyContent: 'center' },

  inputLabel: { fontSize: 13, fontWeight: '700', marginBottom: 7, letterSpacing: 0.2 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  input: { flex: 1, paddingVertical: 13, fontSize: 15.5 },
  inputError: { fontSize: 12, marginTop: -8, marginBottom: 10, marginLeft: 4 },

  seg: { flexDirection: 'row', padding: 3 },
  segThumb: { position: 'absolute', top: 3, bottom: 3, left: 3 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segText: { fontSize: 13.5, letterSpacing: 0.2 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: 8,
  },

  statIconBubble: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  statValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 12.5, marginTop: 3, fontWeight: '600' },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: radius.lg,
    marginBottom: 8,
  },
  txnIcon: {
    width: 38, height: 38, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  txnDesc: { fontSize: 14, fontWeight: '700' },
  txnDate: { fontSize: 11.5, marginTop: 2 },
  txnAmt: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },

  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 32 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySub: { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  splitTrack: { flexDirection: 'row', overflow: 'hidden' },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { fontSize: 12, fontWeight: '600' },

  sheetTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  confirmMsg: { fontSize: 14, lineHeight: 21 },

  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, marginTop: 2 },
});
