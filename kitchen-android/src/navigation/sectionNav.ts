// Cross-screen section navigation — screens (and push handlers) can request
// a section switch without knowing about the AppShell.

import type { SectionId } from '../lib/permissions';

type Listener = (section: SectionId) => void;
const listeners = new Set<Listener>();

export function onNavigateToSection(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigateToSection(section: SectionId): void {
  listeners.forEach((listener) => listener(section));
}
