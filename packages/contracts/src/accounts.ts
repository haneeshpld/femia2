import { z } from 'zod';
import { Email, Phone, Pincode } from './common.ts';
import { passwordProblem } from './password.ts';

/** Accounts: shoppers sign in with an emailed code; the Admin team with a password and a code. */
export const Code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const EmailStart = z.object({ email: Email });
export const CodeVerify = z.object({ email: Email, code: Code });

const Name = z.string().trim().min(2, 'Enter your name').max(80);
export const CustomerRegister = z.object({
  signupToken: z.string().min(20).max(600),
  name: Name,
  phone: Phone,
  marketing: z.boolean().default(false),
});
export const ProfileUpdate = z.object({ name: Name, phone: Phone, marketing: z.boolean().default(false) });

export const AddressInput = z.object({
  label: z.string().trim().max(24).default(''),
  name: Name,
  phone: Phone,
  line1: z.string().trim().min(3, 'Enter your house / street').max(120),
  line2: z.string().trim().max(120).default(''),
  landmark: z.string().trim().max(80).default(''),
  city: z.string().trim().min(2, 'Enter your town or city').max(60),
  state: z.string().trim().max(40).default('Kerala'),
  pincode: Pincode,
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.input<typeof AddressInput>;

export interface CustomerAddress { id: string; label: string; name: string; phone: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string; isDefault: boolean }
export interface CustomerProfile { id: string; email: string; name: string; phone: string; marketing: boolean; createdAt: string }

const Password = z.string().min(1, 'Enter a password').max(128);
export const AdminSignup = z.object({ name: Name, email: Email, password: Password }).superRefine((v, ctx) => {
  const p = passwordProblem(v.password, v);
  if (p) ctx.addIssue({ code: 'custom', path: ['password'], message: p });
});
export const AdminLogin = z.object({ email: Email, password: Password });
export const AdminLoginVerify = z.object({ challenge: z.string().min(20).max(600), code: Code });
export const AdminReset = z.object({ email: Email, code: Code, password: Password }).superRefine((v, ctx) => {
  const p = passwordProblem(v.password, v);
  if (p) ctx.addIssue({ code: 'custom', path: ['password'], message: p });
});
export const PasswordChange = z.object({ current: Password, next: Password });
export const AdminInvite = z.object({ email: Email, name: z.string().trim().max(80).default(''), roleId: z.string().min(1) });
export const AdminApprove = z.object({ roleId: z.string().min(1) });
