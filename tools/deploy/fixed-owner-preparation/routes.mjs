// SPDX-License-Identifier: MIT
// @ts-check

/** @typedef {import("./untrusted-envelope.js").PreparedRoute} PreparedRoute */

/** @typedef {Readonly<{method: "POST", target: string, route: PreparedRoute, consoleTarget: string}>} RouteMapping */

/** @type {RouteMapping[]} */
const ROUTE_MAPPINGS = [
  {
    method: "POST",
    target: "/api/console-owner/v2/context-owner/invocations",
    route: "invoke",
    consoleTarget: "/v2/context-owner/invocations",
  },
  {
    method: "POST",
    target: "/api/console-owner/v2/context-owner/invocations/receipt-lookup",
    route: "receipt_lookup",
    consoleTarget: "/v2/context-owner/invocations/receipt-lookup",
  },
  {
    method: "POST",
    target: "/api/console-owner/v2/context-owner/invocations/cached-result",
    route: "cached_result",
    consoleTarget: "/v2/context-owner/invocations/cached-result",
  },
];

export const PREPARATION_ROUTES = Object.freeze(
  ROUTE_MAPPINGS.map((mapping) => Object.freeze(mapping)),
);

/** @type {Map<string, PreparedRoute>} */
const ROUTE_BY_TARGET = new Map();
for (const mapping of PREPARATION_ROUTES) {
  ROUTE_BY_TARGET.set(mapping.target, mapping.route);
}

/**
 * Matches exact input text only. The caller must already have bounded and
 * decoded an origin-form request target; this function performs no parsing.
 * @param {string} method
 * @param {string} target
 * @returns {PreparedRoute | null}
 */
export function resolvePreparationRoute(method, target) {
  if (method !== "POST") return null;
  return ROUTE_BY_TARGET.get(target) ?? null;
}
