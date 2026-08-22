/**
 * CartProvider — the single runtime owner of cart state. All customer UI
 * reads/writes through this context; persistence uses the pure helpers in
 * cart.ts (localStorage, defensive parse). The drawer open-state lives here
 * so the navbar badge, menu pages and checkout stay in lock-step.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addItem as addItemPure,
  clearCart as clearCartPure,
  emptyCart,
  readCart,
  removeItem as removeItemPure,
  updateQuantity as updateQuantityPure,
  writeCart,
} from '../cart';
import type { CartItem, CartState, Fulfilment } from '../types';

interface CartContextValue {
  cart: CartState;
  count: number;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addItem: (item: Omit<CartItem, 'key'>) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  setFulfilment: (fulfilment: Fulfilment) => void;
  setCoupon: (code: string | undefined) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  // Lazy init from localStorage exactly once.
  const [cart, setCart] = useState<CartState>(() => (typeof window === 'undefined' ? emptyCart() : readCart()));
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  const addItem = useCallback((item: Omit<CartItem, 'key'>) => {
    setCart((current) => addItemPure(current, item));
    setDrawerOpen(true);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      count: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      addItem,
      updateQuantity: (key, quantity) => setCart((c) => updateQuantityPure(c, key, quantity)),
      removeItem: (key) => setCart((c) => removeItemPure(c, key)),
      setFulfilment: (fulfilment) => setCart((c) => ({ ...c, fulfilment })),
      setCoupon: (code) => setCart((c) => ({ ...c, couponCode: code })),
      clear: () => setCart((c) => clearCartPure(c)),
    }),
    [cart, drawerOpen, addItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}
