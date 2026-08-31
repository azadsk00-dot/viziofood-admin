// Combo choice-group selection rules — shared by the customer builder,
// admin validation and tests. Pure functions.
//
//   • minimum = how many selections are REQUIRED
//   • maximum = how many selections are ALLOWED
//   • groups are configured independently; min ≤ max always

export interface SelectionRule {
  minSelections: number;
  maxSelections: number;
}

/**
 * Human rule text for a group header:
 *   min === max > 0  → "Choose exactly 2 pizzas"
 *   min > 0, max > 0 → "Choose 3–5 pizzas"
 *   min === 0        → "Choose up to 4 (optional)" / "None"
 */
export function describeComboRule(rule: SelectionRule): string {
  const { minSelections: min, maxSelections: max } = rule;
  if (min === max) {
    if (min <= 0) return 'None';
    return min === 1 ? 'Choose 1' : `Choose exactly ${min}`;
  }
  if (min > 0) return `Choose ${min}–${max}`;
  return max > 0 ? `Choose up to ${max} (optional)` : 'None';
}

/** True when a configuration is internally valid (0 ≤ min ≤ max). */
export function isValidRule(rule: SelectionRule): boolean {
  return (
    Number.isInteger(rule.minSelections) &&
    Number.isInteger(rule.maxSelections) &&
    rule.minSelections >= 0 &&
    rule.maxSelections >= 0 &&
    rule.minSelections <= rule.maxSelections
  );
}

/**
 * Validate a made selection count against a rule:
 *   null    → satisfied
 *   'under' → below the minimum (cannot add the combo)
 *   'over'  → above the maximum (selection is refused before it happens;
 *             max 0 means nothing may be chosen)
 */
export function selectionCountError(rule: SelectionRule, count: number): 'under' | 'over' | null {
  if (count < rule.minSelections) return 'under';
  if (count > rule.maxSelections) return 'over';
  return null;
}

/** True when one MORE selection would exceed the maximum. */
export function atSelectionLimit(rule: SelectionRule, count: number): boolean {
  return count >= rule.maxSelections;
}

/**
 * A configuration can only satisfy its minimum when the group actually
 * contains enough eligible products (max 0 needs none — nothing is pickable).
 */
export function enoughOptionsFor(rule: SelectionRule, optionCount: number): boolean {
  if (rule.maxSelections === 0) return true;
  return optionCount >= rule.minSelections;
}
