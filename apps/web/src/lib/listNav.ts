const LIST_FROM_KEY = "shopad.ordersListFrom";

export function setOrdersListFrom(path: string) {
  try {
    sessionStorage.setItem(LIST_FROM_KEY, path);
  } catch {
    // ignore quota / private mode
  }
}

export function getOrdersListFrom(): string | null {
  try {
    return sessionStorage.getItem(LIST_FROM_KEY);
  } catch {
    return null;
  }
}

export const COD_MENU_PATHS = new Set([
  "/cod/pending_review",
  "/cod/awaiting_shipment",
  "/cod/shipped",
  "/cod/completed",
  "/cod/refused",
  "/cod/invalid",
]);

export function isCodListPath(path: string | null | undefined): boolean {
  return Boolean(path && COD_MENU_PATHS.has(path));
}
