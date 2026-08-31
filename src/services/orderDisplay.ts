/**
 * Order display normalisation — kitchen staff must never see raw database IDs.
 *
 * Order items snapshot their display names at order time (combo choices and
 * modifiers carry names inside order_items.modifiers / combo_selections), so
 * renaming or removing a product later never changes history. Rows written
 * before that snapshotting existed — or by a buggy writer — can still hold
 * bare UUIDs where a name belongs. These helpers swap any UUID token in a
 * display string for the product's current name, falling back to a human
 * label when the product no longer exists. Pure display logic: pricing and
 * payment fields are never touched.
 */

const UUID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const UUID_TEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shown when a referenced product cannot be found at all — never its UUID. */
export const MISSING_ITEM_LABEL = 'Item no longer on menu';

/** id → current product name, used to repair legacy UUID-only display strings. */
export type NameLookup = Map<string, string>;

export const containsUuid = (value: string): boolean => UUID_TEST.test(value.trim());

export function normaliseDisplayText(value: string, names: NameLookup): string {
  if (!value) return value;
  return value.replace(UUID_TOKEN, (token) => names.get(token.toLowerCase()) ?? MISSING_ITEM_LABEL);
}

export const normaliseModifierLines = (lines: string[], names: NameLookup): string[] =>
  lines.map((line) => normaliseDisplayText(line, names));

export function normaliseOrderItem<T extends { name: string; modifiers: string[] }>(item: T, names: NameLookup): T {
  return {
    ...item,
    name: normaliseDisplayText(item.name, names),
    modifiers: normaliseModifierLines(item.modifiers, names),
  };
}

/** Build the lookup from a raw `select id,name` result set. */
export const nameLookupFromRows = (rows: Array<{ id: string | unknown; name: string | unknown }>): NameLookup =>
  new Map(rows.map((row) => [String(row.id).toLowerCase(), String(row.name ?? '')]));
