// AppShell — responsive tablet navigation.
//   Landscape / wide (≥820px): persistent left sidebar + content.
//   Portrait / narrow: top bar + slide-in drawer with the same sections.
// All screens reflow via useWindowDimensions; nothing is stretched.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../state/authStore';
import { useOrdersStore } from '../state/ordersStore';
import { SECTION_GROUPS, defaultSectionFor, visibleSections } from '../navigation/sections';
import { onNavigateToSection } from '../navigation/sectionNav';
import type { SectionId } from '../lib/permissions';
import { dark } from '../theme';

const WIDE_BREAKPOINT = 820;

export function AppShell(): React.ReactElement {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const role = useAuthStore((s) => s.role);
  const email = useAuthStore((s) => s.email);
  const signOut = useAuthStore((s) => s.signOut);
  const online = useOrdersStore((s) => s.internetOnline);

  const wide = width >= WIDE_BREAKPOINT;
  const sections = useMemo(() => visibleSections(role), [role]);
  const [active, setActive] = useState<SectionId>(() => defaultSectionFor(role));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Role changes (sign-in) reset to the default landing section.
  useEffect(() => {
    if (role) setActive(defaultSectionFor(role));
  }, [role]);

  // Other screens / push handlers can request a section switch.
  useEffect(() => onNavigateToSection((section) => setActive(section)), []);

  const ActiveComponent = sections.find((s) => s.id === active)?.component;
  const activeTitle = sections.find((s) => s.id === active)?.title ?? '';

  const navContent = (
    <NavList
      sections={sections}
      active={active}
      onSelect={(id) => {
        setActive(id);
        setDrawerOpen(false);
      }}
      email={email}
      role={role}
      onSignOut={() => void signOut()}
      wide={wide}
    />
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: dark.background }]}>
      {wide ? (
        <View style={styles.row}>
          <View style={[styles.sidebar, { paddingBottom: Math.max(12, insets.bottom) }]}>{navContent}</View>
          <View style={styles.content}>{ActiveComponent ? <ActiveComponent /> : null}</View>
        </View>
      ) : (
        <View style={styles.column}>
          <View style={[styles.topBar, { paddingTop: 8 }]}>
            <Pressable style={styles.menuButton} onPress={() => setDrawerOpen(true)} hitSlop={12}>
              <Text style={styles.menuGlyph}>☰</Text>
            </Pressable>
            <Text style={styles.topTitle} numberOfLines={1}>{activeTitle.toUpperCase()}</Text>
            <View style={[styles.dot, { backgroundColor: online ? dark.online : dark.offline }]} />
          </View>
          <View style={styles.content}>{ActiveComponent ? <ActiveComponent /> : null}</View>
          <Modal visible={drawerOpen} transparent animationType="slide" onRequestClose={() => setDrawerOpen(false)}>
            <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)}>
              <Pressable style={styles.drawer} onPress={(e) => e.stopPropagation()}>
                {navContent}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      )}
    </View>
  );
}

function NavList(props: {
  sections: ReturnType<typeof visibleSections>;
  active: SectionId;
  onSelect: (id: SectionId) => void;
  email: string | null;
  role: string | null;
  onSignOut: () => void;
  wide: boolean;
}): React.ReactElement {
  return (
    <View style={styles.nav}>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>VIZIO FOOD</Text>
        <Text style={styles.brandSub}>Management</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {SECTION_GROUPS.map((group) => {
          const items = props.sections.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <View key={group}>
              <Text style={styles.groupLabel}>{group.toUpperCase()}</Text>
              {items.map((section) => {
                const isActive = section.id === props.active;
                return (
                  <Pressable
                    key={section.id}
                    onPress={() => props.onSelect(section.id)}
                    style={[styles.navItem, isActive && styles.navItemActive]}
                  >
                    <Text style={styles.navGlyph}>{section.glyph}</Text>
                    <Text style={[styles.navLabel, { color: isActive ? dark.accentText : dark.text }]} numberOfLines={1}>
                      {section.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.navFooter}>
        <Text style={styles.navUser} numberOfLines={1}>{props.email ?? ''}</Text>
        <Text style={styles.navRole}>{(props.role ?? '').toUpperCase()}</Text>
        <Pressable style={styles.signOut} onPress={props.onSignOut}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  column: { flex: 1 },
  sidebar: { width: 232, borderRightWidth: 1, borderRightColor: dark.border, backgroundColor: dark.surface },
  content: { flex: 1 },
  nav: { flex: 1 },
  brandRow: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: dark.border },
  brand: { color: dark.accent, fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  brandSub: { color: dark.textDim, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  groupLabel: { color: dark.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 14, marginBottom: 4, paddingHorizontal: 16 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, marginHorizontal: 8, marginVertical: 1 },
  navItemActive: { backgroundColor: dark.accent },
  navGlyph: { fontSize: 17 },
  navLabel: { fontSize: 15, fontWeight: '700' },
  navFooter: { borderTopWidth: 1, borderTopColor: dark.border, padding: 12 },
  navUser: { color: dark.textDim, fontSize: 12, fontWeight: '600' },
  navRole: { color: dark.text, fontSize: 13, fontWeight: '900', letterSpacing: 1, marginTop: 2 },
  signOut: { marginTop: 8, borderWidth: 1.5, borderColor: dark.danger, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  signOutText: { color: dark.danger, fontWeight: '900', fontSize: 13, letterSpacing: 0.8 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: dark.border, backgroundColor: dark.surface },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: dark.surfaceAlt },
  menuGlyph: { color: dark.text, fontSize: 22 },
  topTitle: { flex: 1, color: dark.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row' },
  drawer: { width: 268, backgroundColor: dark.surface, borderRightWidth: 1, borderRightColor: dark.border },
});
