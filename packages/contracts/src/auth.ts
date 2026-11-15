export const PERMISSIONS = [
  'dashboard.view',
  'catalog.read', 'catalog.write',
  'offers.write',
  'stock.write',
  'media.write',
  'orders.read', 'orders.write',
  'content.write', 'content.publish',
  'settings.read', 'settings.write',
  'payments.keys', 'payments.refund',
  'people.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Seeded roles for 1.0. The roles table accepts any permission set (Manager/Editor arrive in 1.2). */
export const DEFAULT_ROLES: Record<'owner' | 'staff', Permission[]> = {
  owner: [...PERMISSIONS],
  staff: ['dashboard.view', 'catalog.read', 'catalog.write', 'stock.write', 'media.write', 'orders.read', 'orders.write', 'content.write'],
};
