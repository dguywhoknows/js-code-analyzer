/* A small sample project for the multi-file pages. */
var DEMO_PROJECT = [
  { name: 'src/cart.js', src: `import { taxFor } from './tax.js';
import { roundMoney, clamp } from './utils/money.js';

export class Cart {
  constructor() { this.items = []; }
  add(item, qty = 1) {
    if (qty <= 0) throw new Error('qty');
    const hit = this.items.find((i) => i.sku === item.sku);
    if (hit) hit.qty += qty; else this.items.push({ ...item, qty });
  }
  subtotal() { return this.items.reduce((s, i) => s + i.price * i.qty, 0); }
  total(region, coupon) { return roundMoney(clamp(this.subtotal() - discount(this, coupon), 0, Infinity) * (1 + taxFor(region))); }
}

export function discount(cart, coupon) {
  let d = 0;
  if (!coupon) return 0;
  if (coupon.type === 'percent') d = cart.subtotal() * coupon.value / 100;
  else if (coupon.type === 'fixed') d = coupon.value;
  else if (coupon.type === 'bogo') {
    for (const i of cart.items) {
      if (i.qty >= 2 && (i.category === 'books' || i.category === 'toys')) d += Math.floor(i.qty / 2) * i.price;
    }
  }
  if (coupon.min && cart.subtotal() < coupon.min) return 0;
  return d;
}
` },
  { name: 'src/tax.js', src: `const RATES = { ON: 0.13, QC: 0.14975, BC: 0.12, AB: 0.05 };

export function taxFor(region) {
  if (!region) return 0;
  const r = RATES[region.toUpperCase()];
  return r ?? 0.13;
}

function legacyRate(region) {
  switch (region) { case 'ON': return 0.13; case 'QC': return 0.15; default: return 0.1; }
}
` },
  { name: 'src/utils/money.js', src: `export const roundMoney = (n) => Math.round(n * 100) / 100;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function formatMoney(n, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(n);
}
` },
  { name: 'src/checkout.js', src: `import { Cart } from './cart.js';
import { formatMoney } from './utils/money.js';

export async function checkout(user, items, coupon) {
  const cart = new Cart();
  items.forEach((i) => cart.add(i, i.qty));
  const total = cart.total(user.region, coupon);
  if (user.balance < total) {
    if (user.credit && user.credit.limit - user.credit.used >= total) return { ok: true, method: 'credit', total: formatMoney(total) };
    return { ok: false, reason: 'insufficient funds' };
  }
  try {
    await charge(user, total);
    return { ok: true, method: 'balance', total: formatMoney(total) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function charge(user, amount) {
  if (amount <= 0) throw new Error('bad amount');
  user.balance -= amount;
}
` },
];
