import { z } from 'zod';

export const ContextDocCategory = z.enum(['specs', 'docs', 'insights', 'other']);
export type ContextDocCategory = z.infer<typeof ContextDocCategory>;

export const SpecReadEntry = z.object({
  path: z.string(),
  category: ContextDocCategory,
  tokens: z.number(),
});
export type SpecReadEntry = z.infer<typeof SpecReadEntry>;
