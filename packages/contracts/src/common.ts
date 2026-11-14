import { z } from 'zod';

export const Id = z.string().min(1).max(64);
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes only').max(80);
export const Paise = z.number().int().nonnegative();
/** All money is integer paise. ₹1,299 === 129900. */
export type Paise = z.infer<typeof Paise>;
/** Indian mobile: 10 digits starting 6-9; accepts +91 / 0 prefixes and spaces. */
export const Phone = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));
export const Pincode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode');
export const Email = z.email('Enter a valid email address').trim().toLowerCase();
export const IsoDate = z.string();

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;
