/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_SUPABASE_URL?: string; readonly VITE_SUPABASE_ANON_KEY?: string; readonly VITE_STRIPE_CHECKOUT_ENDPOINT?: string; readonly VITE_REFUND_ENDPOINT?: string; readonly VITE_CHECKOUT_VERIFY_ENDPOINT?: string; }
interface ImportMeta { readonly env: ImportMetaEnv }
