// Re-exports so the catering tabs can use the existing product image
// uploader/delete helpers without duplicating the storage layer.
export { uploadProductImage, deleteProductImage } from './supabase';
export type { AdminCateringProduct } from './cateringService';
