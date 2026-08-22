// Homepage promo (legacy homepage_content), branding upload, customers,
// users, audit log, printers admin, and image upload — the remaining admin
// services, grouped by domain.

import { supabase } from '../../lib/supabase';
import type {
  AdminPrinter, AdminUser, AuditEntry, CustomerSummary, HomepageContent,
} from '../../lib/adminTypes';

// ─── Homepage content (promo banner) ───────────────────────────────────────

export async function getHomepageContent(): Promise<HomepageContent | null> {
  const { data, error } = await supabase
    .from('homepage_content')
    .select('id,enabled,promo_type,title,description,price,image_url,button_text,button_link,start_date,end_date')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/42P01|PGRST205/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    enabled: Boolean(r.enabled),
    promoType: ((r.promo_type as string) ?? 'daily') as HomepageContent['promoType'],
    title: (r.title as string) ?? '',
    description: (r.description as string) ?? '',
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    imageUrl: (r.image_url as string | null) ?? null,
    buttonText: (r.button_text as string) ?? '',
    buttonLink: (r.button_link as string) ?? '',
    startDate: (r.start_date as string | null) ?? null,
    endDate: (r.end_date as string | null) ?? null,
  };
}

export async function saveHomepageContent(
  content: HomepageContent,
): Promise<void> {
  if (content.enabled && !content.title.trim()) throw new Error('Enable requires a title.');
  const { data: userData } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    enabled: content.enabled,
    promo_type: content.promoType,
    title: content.title.trim(),
    description: content.description,
    price: content.price,
    image_url: content.imageUrl,
    button_text: content.buttonText,
    button_link: content.buttonLink,
    start_date: content.startDate || null,
    end_date: content.endDate || null,
  };
  const { data: existing } = await supabase
    .from('homepage_content')
    .select('id')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  const result = existing
    ? await supabase.from('homepage_content').update(row).eq('id', (existing as { id: string }).id).select('id').single()
    : await supabase.from('homepage_content').insert(row).select('id').single();
  if (result.error) throw new Error(result.error.message);
  try {
    await supabase.from('admin_audit_log').insert({
      user_id: userData.user?.id ?? null,
      action: 'homepage_content_changed',
      details: { enabled: content.enabled, title: content.title, promo_type: content.promoType },
    });
  } catch {
    // best-effort
  }
}

// ─── Customers (aggregated from orders, RLS-respecting read) ───────────────

export async function getCustomerSummaries(): Promise<CustomerSummary[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('customer_name,customer_email,customer_phone,total,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const map = new Map<string, CustomerSummary>();
  for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const email = ((raw.customer_email as string) ?? '').toLowerCase();
    const phone = (raw.customer_phone as string) ?? '';
    const key = email || phone.replace(/\s+/g, '') || '_';
    const entry =
      map.get(key) ??
      { id: key, name: '', email: (raw.customer_email as string) ?? '', phone, orders: 0, spend: 0, lastOrder: '' };
    if (!entry.name && raw.customer_name) entry.name = raw.customer_name as string;
    if (!entry.phone && phone) entry.phone = phone;
    entry.orders += 1;
    entry.spend += Number(raw.total ?? 0);
    entry.lastOrder = (raw.created_at as string) ?? entry.lastOrder;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.lastOrder) - Date.parse(a.lastOrder));
}

// ─── Users / profiles (role changes need the additive migration policy) ────

export async function getUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,role,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      email: '', // emails are not exposed via profiles; shown as id when absent
      fullName: (r.full_name as string) ?? '',
      role: (r.role as string) ?? 'customer',
      createdAt: (r.created_at as string) ?? '',
    };
  });
}

export async function updateUserRole(userId: string, role: AdminUser['role']): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) {
    if (/42501|row-level security|permission/i.test(error.message)) {
      throw new Error('Blocked by RLS — apply migration 20260827000001_admin_profiles_role.sql first (not deployed yet).');
    }
    throw new Error(error.message);
  }
}

// ─── Audit log ─────────────────────────────────────────────────────────────

export async function getAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id,user_id,action,details,order_id,reason,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      userId: (r.user_id as string | null) ?? null,
      action: (r.action as string) ?? '',
      details: (r.details as Record<string, unknown>) ?? {},
      orderId: (r.order_id as string | null) ?? null,
      reason: (r.reason as string) ?? '',
      createdAt: (r.created_at as string) ?? '',
    };
  });
}

// ─── Printers admin (CRUD; printing stays owned by the printer service) ────

export async function getAdminPrinters(): Promise<AdminPrinter[]> {
  const { data, error } = await supabase
    .from('printers')
    .select('id,name,station,connection,host,port,paper_width,enabled,auto_print,copies')
    .order('name');
  if (error) {
    if (/42P01|PGRST205/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      name: (r.name as string) ?? '',
      station: (r.station as string) ?? 'kitchen',
      connection: (r.connection as string) ?? 'network',
      host: (r.host as string) ?? '',
      port: Number(r.port ?? 9100),
      paperWidth: Number(r.paper_width ?? 80),
      enabled: Boolean(r.enabled),
      autoPrint: Boolean(r.auto_print),
      copies: Number(r.copies ?? 1),
    };
  });
}

export async function saveAdminPrinter(printer: Partial<AdminPrinter> & { id?: string }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (printer.name !== undefined) row.name = printer.name.trim();
  if (printer.station !== undefined) row.station = printer.station;
  if (printer.connection !== undefined) row.connection = printer.connection;
  if (printer.host !== undefined) row.host = printer.host.trim();
  if (printer.port !== undefined) row.port = Math.min(65535, Math.max(1, Math.round(printer.port)));
  if (printer.paperWidth !== undefined) row.paper_width = printer.paperWidth;
  if (printer.enabled !== undefined) row.enabled = printer.enabled;
  if (printer.autoPrint !== undefined) row.auto_print = printer.autoPrint;
  if (printer.copies !== undefined) row.copies = Math.min(5, Math.max(1, Math.round(printer.copies)));
  const { error } = printer.id
    ? await supabase.from('printers').update(row).eq('id', printer.id)
    : await supabase.from('printers').insert(row);
  if (error) throw new Error(error.message);
}

export async function deleteAdminPrinter(id: string): Promise<void> {
  const { error } = await supabase.from('printers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
