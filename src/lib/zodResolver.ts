/**
 * Minimal react-hook-form resolver backed by Zod — avoids pulling in
 * @hookform/resolvers (whose ESM build has caused Vite issues). Maps a
 * ZodError to RHF's field-error shape.
 */

import type { Resolver, FieldValues } from 'react-hook-form';
import type { ZodType } from 'zod';

export function zodResolver<T extends FieldValues>(schema: ZodType): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data as T, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (path && !errors[path]) {
        errors[path] = { type: issue.code, message: issue.message };
      }
    }
    return { values: {}, errors: errors as never };
  };
}
