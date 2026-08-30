// Users & permissions — profile list with role changes (admin only).
// Role changes are enforced by RLS: they require the additive migration
// 20260827000001 (NOT deployed yet) — until then the app surfaces the RLS
// error instead of pretending success. UI hiding is never the only guard.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminPage, Card, ConfirmDialog, Pill } from '../../components/admin/kit';
import { updateUserRole, getUsers } from '../../services/admin/misc';
import type { AdminUser } from '../../lib/adminTypes';
import { useAuthStore } from '../../state/authStore';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';
import { formatDateTime } from '../../lib/format';

const ROLES: AdminUser['role'][] = ['admin', 'staff', 'kitchen', 'customer'];

const ROLE_NOTES: Record<string, string> = {
  admin: 'Full access to every section and setting.',
  staff: 'Operational access: orders, menu, specials, coupons, reports, printers (no user management).',
  kitchen: 'Kitchen board, print queue, shift, health, app settings. Cannot manage menu or finances.',
  customer: 'No management access.',
};

export default function UsersScreen(): React.ReactElement {
  const ownId = useAuthStore((s) => s.userId);
  const online = useOrdersStore((s) => s.internetOnline);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pendingRole, setPendingRole] = useState<{ user: AdminUser; role: AdminUser['role'] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await getUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyRole = async () => {
    if (!pendingRole) return;
    try {
      await updateUserRole(pendingRole.user.id, pendingRole.role);
      setMessage(`${pendingRole.user.fullName || pendingRole.user.id.slice(0, 8)} is now ${pendingRole.role}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Role change failed.');
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <AdminPage
      title="Users & permissions"
      subtitle="Roles are enforced by the database (RLS) — not just hidden here"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {users.map((user) => (
        <Card key={user.id} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: dark.text }]} numberOfLines={1}>
                {user.fullName || `User ${user.id.slice(0, 8)}`}
                {user.id === ownId ? ' (you)' : ''}
              </Text>
              <Text style={styles.meta}>Joined {formatDateTime(user.createdAt)}</Text>
            </View>
            <Pill label={user.role.toUpperCase()} tone={user.role === 'admin' ? 'good' : user.role === 'kitchen' ? 'warn' : 'info'} />
          </View>
          <Text style={styles.roleNote}>{ROLE_NOTES[user.role] ?? ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {ROLES.filter((r) => r !== user.role).map((role) => (
              <Pressable
                key={role}
                style={[styles.roleButton, role === 'admin' && { borderColor: dark.success }, role === 'customer' && { borderColor: dark.danger }]}
                disabled={!online || user.id === ownId}
                onPress={() => setPendingRole({ user, role })}
              >
                <Text style={styles.roleButtonText}>SET {role.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          {user.id === ownId ? <Text style={styles.meta}>You cannot change your own role here.</Text> : null}
        </Card>
      ))}

      <ConfirmDialog
        visible={pendingRole !== null}
        title={`Make ${(pendingRole?.user.fullName || pendingRole?.user.id.slice(0, 8)) ?? ''} ${pendingRole?.role ?? ''}?`}
        message={ROLE_NOTES[pendingRole?.role ?? ''] ?? ''}
        confirmLabel={`SET ${pendingRole?.role?.toUpperCase() ?? ''}`}
        onCancel={() => setPendingRole(null)}
        onConfirm={() => void applyRole()}
      />

      <Text style={styles.hint}>
        Role writes go through RLS policy kitchen/profiles updates. If the policy migration is not applied yet, the
        database rejects the change and this screen shows the exact error — by design.
      </Text>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '800' },
  meta: { color: dark.textDim, fontSize: 12, marginTop: 4 },
  roleNote: { color: dark.textDim, fontSize: 12, marginTop: 6, lineHeight: 17 },
  roleButton: { borderWidth: 1.5, borderColor: dark.info, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  roleButtonText: { color: dark.info, fontWeight: '800', fontSize: 12 },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 14, lineHeight: 18 },
});
