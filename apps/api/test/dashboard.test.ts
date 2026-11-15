import { beforeEach, describe, expect, it } from 'vitest';
import { call, checkout, E, seedBasics, seedProduct } from './helpers.ts';

beforeEach(seedBasics);

describe('dashboard', () => {
  it('counts orders in every stage and flags ones sitting too long', async () => {
    const { variantIds: [v] } = await seedProduct([20], 129900);
    const place = async (method: string) => (await call('POST', '/orders', checkout(v!, method))).json.order.number as string;
    const move = (n: string, to: string, extra: Record<string, unknown> = {}) => call('POST', `/admin/orders/${n}/transition`, { to, ...extra });

    await place('upi'); // awaiting payment
    const n1 = await place('cod'); // new
    const n2 = await place('cod'); await move(n2, 'confirmed');
    const n3 = await place('cod'); await move(n3, 'confirmed'); await move(n3, 'packed');
    const n4 = await place('cod'); await move(n4, 'confirmed'); await move(n4, 'packed'); await move(n4, 'shipped', { courier: 'India Post', trackingNumber: 'EK1' });
    const n5 = await place('cod'); await move(n5, 'cancelled', { reason: 'Customer asked' });
    await E.DB.prepare('UPDATE orders SET updated_at = ? WHERE number = ?').bind(new Date(Date.now() - 2 * 864e5).toISOString(), n1).run();

    const d = (await call('GET', '/admin/dashboard')).json;
    const counts = Object.fromEntries(Object.entries(d.pipeline).map(([k, x]) => [k, (x as { count: number }).count]));
    expect(counts).toMatchObject({ pending_payment: 1, new: 1, confirmed: 1, packed: 1, shipped: 1, cancelled: 1 });
    expect(d.pipeline.new.stalled).toBe(1);
    expect(d.codToCollect.orders).toBe(4);
    expect(d.topProducts[0]).toMatchObject({ qty: 4 });
  });
});
