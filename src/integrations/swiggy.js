/**
 * Reads recent Swiggy Food orders through its MCP tools and returns them in one
 * neutral shape. Only delivered orders count: one still on its way can be
 * cancelled, and a cancelled one cost nothing.
 *
 * Tool reference: https://mcp.swiggy.com/builders/docs/reference/food/
 */
import { ApiError } from '../utils/ApiError.js';

const SKIPPED_STATUS = /cancel|fail|refund|reject/i;

export async function swiggyFoodOrders(call, { count }) {
  // Order history needs an address id to resolve coordinates, but it is not
  // filtered by it, so any saved address will do.
  const addresses = unwrap(await call('get_addresses', {}));
  const addressId = addresses?.resolution?.defaultAddressId ?? addresses?.addresses?.[0]?.id;
  if (!addressId) {
    throw ApiError.badRequest('Add a delivery address in Swiggy first, then ask me again.');
  }

  const history = unwrap(
    await call('get_food_orders', { addressId, orderCount: Math.min(15, count + 5) })
  );
  const delivered = (history?.orders ?? [])
    .filter(
      (order) =>
        order?.orderId &&
        !order.isActiveOrder &&
        !SKIPPED_STATUS.test(`${order.orderStatus ?? ''} ${order.orderDeliveryStatus ?? ''}`)
    )
    .slice(0, count);

  const orders = [];
  // One at a time: a handful of orders, and kinder to a shared session.
  for (const order of delivered) {
    const details = await call('get_food_order_details', { orderId: String(order.orderId) })
      .then((payload) => unwrap(payload)?.order ?? null)
      .catch(() => null);

    orders.push({
      id: String(order.orderId),
      restaurant: String(details?.restaurant_name || order.restaurantName || 'Swiggy').slice(0, 120),
      amount: amountOf(details?.order_total ?? order.orderTotal),
      orderedAt: dateOf(details?.order_time ?? order.orderedTime),
      items: details?.order_items?.length
        ? details.order_items.map((item) => ({ name: String(item.name), quantity: quantityOf(item) }))
        : itemsFromText(order.orderedItems)
    });
  }
  return orders;
}

/** Every Swiggy tool answers `{ success, data, message }`. */
function unwrap(payload) {
  if (payload?.success === false) {
    throw new Error(payload?.error?.message || 'Swiggy could not complete that request');
  }
  return payload?.data ?? payload;
}

function amountOf(value) {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function dateOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const parsed = numeric
    ? new Date(Number(value) < 1e12 ? Number(value) * 1000 : Number(value))
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function quantityOf(item) {
  const count = Number.parseFloat(item.quantity) || 1;
  const portion = item.attributes?.portionSize || item.variants?.map((v) => v.name).join(', ');
  return (portion ? `${count} x ${portion}` : `${count} restaurant serving${count === 1 ? '' : 's'}`).slice(0, 60);
}

/** Fallback when the details call fails: "Chicken Biryani x 1, Raita x 2". */
function itemsFromText(text) {
  return String(text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)\s*[xX\u00D7]\s*(\d+)$/) ?? part.match(/^(\d+)\s*[xX\u00D7]\s*(.*)$/);
      if (!match) return { name: part, quantity: '1 restaurant serving' };
      const [name, count] = /^\d+$/.test(match[1]) ? [match[2], match[1]] : [match[1], match[2]];
      return { name: name.trim(), quantity: `${count} restaurant serving${count === '1' ? '' : 's'}` };
    });
}
