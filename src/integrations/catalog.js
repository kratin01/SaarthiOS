/**
 * Outside apps a user can link so the assistant can read their orders.
 *
 * Each one is a remote MCP server that signs people in with OAuth. `blocked`
 * means the provider itself does not let apps like SaarthiOS connect yet; it is
 * still listed so people looking for it learn why. Whether an app is switched
 * on for this server is decided in connectionService (CONNECTED_APPS).
 */
import { swiggyFoodOrders } from './swiggy.js';

const APPS = [
  {
    id: 'swiggy',
    label: 'Swiggy',
    description: 'Food orders become an expense and a meal.',
    mcpUrl: 'https://mcp.swiggy.com/food',
    scope: 'mcp:tools',
    orders: swiggyFoodOrders
  },
  {
    id: 'zomato',
    label: 'Zomato',
    description: 'Food orders become an expense and a meal.',
    mcpUrl: 'https://mcp-server.zomato.com/mcp',
    blocked:
      'Zomato does not let other apps connect yet. You can still tell the assistant what you ordered.'
  }
];

export const listApps = () => APPS;

/** Accepts the id or a phrase containing it, such as "swiggy food". */
export function findApp(value) {
  const words = String(value ?? '').toLowerCase().trim().split(/\s+/);
  return APPS.find((app) => words.includes(app.id)) ?? null;
}
