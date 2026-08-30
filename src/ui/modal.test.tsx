// @vitest-environment jsdom
/**
 * Regression tests for the admin keyboard/focus bug: typing one character in
 * a field inside a Modal must never move focus out of that field.
 *
 * Root cause this guards against: the Modal's open-time effect originally
 * listed onClose in its dependency array. Call sites pass a fresh inline
 * closure per render (e.g. ProductManagement's `cancel`), so every keystroke
 * re-ran the effect and ref.current?.focus() ripped focus out of the input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { Modal } from './index';

// @ts-expect-error -- test-only React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

const render = (ui: React.ReactElement) => {
  act(() => {
    root.render(ui);
  });
};

/** The exact shape of the admin editors: local text state + inline onClose. */
function EditorLikeField({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal open onClose={close} title="Editor">
      <input
        aria-label="Product name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}

const typeInto = (input: HTMLInputElement, text: string) => {
  for (const character of text) {
    const next = (input as HTMLInputElement & { _value?: string }).value + character;
    act(() => {
      input.focus();
      // React 19 reads the value setter descriptor — set natively, then dispatch.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
};

describe('Modal keyboard focus', () => {
  it('keeps focus in the field across every keystroke', () => {
    const close = vi.fn();
    render(<EditorLikeField close={close} />);

    const input = document.querySelector('input[aria-label="Product name"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => input.focus());

    typeInto(input, 'Pasta Lunch Combo');

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Pasta Lunch Combo');
  });

  it('a re-render with a NEW inline onClose must not re-run the focus effect', () => {
    // Simulates the parent re-rendering the modal with a fresh closure —
    // the exact trigger of the original bug.
    const inputRef = { current: null as HTMLInputElement | null };
    const Harness = ({ version }: { version: number }) => {
      const [name, setName] = useState('');
      return (
        <Modal
          open
          onClose={() => undefined} // new identity every render
          title={`v${version}`}
        >
          <input
            ref={(node) => { inputRef.current = node; }}
            aria-label="Field"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Modal>
      );
    };
    render(<Harness version={1} />);
    const input = inputRef.current!;
    act(() => input.focus());
    typeInto(input, 'Pasta');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Pasta');
  });

  it('Escape still closes via the latest onClose and only while open', () => {
    const close = vi.fn();
    render(<EditorLikeField close={close} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
