import { describe, expect, it } from 'vitest';
import { ORDER_TYPES, orderSchema, parseOrder } from './orders';

describe('orders', () => {
  it('accepts each order type as plain JSON', () => {
    const orders = [
      { id: 1, faction: 'red', type: 'move', units: [4, 5], target: { x: 3, y: 2 } },
      { id: 2, faction: 'red', type: 'attack', units: [4], target: 9 },
      { id: 3, faction: 'blue-2', type: 'stop', units: [7] },
    ];
    for (const order of orders) expect(parseOrder(order)).toEqual({ ok: true, order });
    expect(orders.map((o) => o.type)).toEqual(ORDER_TYPES);
    expect(JSON.parse(JSON.stringify(orderSchema.parse(orders[0])))).toEqual(orders[0]);
  });

  it('refuses a bad order naming each bad field', () => {
    const result = parseOrder({
      id: 0,
      faction: '9x',
      type: 'move',
      units: [1, 1],
      target: { x: 1.5, y: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const lines = result.error.split('\n');
    expect(lines.some((l) => l.startsWith('id: '))).toBe(true);
    expect(lines.some((l) => l.startsWith('faction: '))).toBe(true);
    expect(lines).toContain('units: units must not repeat');
    expect(lines.some((l) => l.startsWith('target.x: '))).toBe(true);
    expect(parseOrder({ id: 1, faction: 'red', type: 'stop', units: [1], extra: true }).ok).toBe(false);
    expect(parseOrder({ id: 1, faction: 'red', type: 'attack', units: [1], target: { x: 1, y: 1 } }).ok).toBe(
      false,
    );
    expect(parseOrder({ id: 1, faction: 'red', type: 'fly', units: [1] }).ok).toBe(false);
  });
});
