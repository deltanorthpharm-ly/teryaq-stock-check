export type Availability = "available" | "unavailable";

export type StockCheckItem = {
  itemCode: string | null;
  name: string;
  barcode: string | null;
  sellingPrice: number | null;
  quantity: number;
  formattedQuantity: string;
  unit: string | null;
  availability: Availability;
};

export type SessionResponse = {
  success: boolean;
  authenticated: boolean;
  expiresAt?: string | null;
};

export type StatusResponse = {
  success: boolean;
  live: boolean;
  serverTime?: string | null;
  lastSuccessfulCheck?: string | null;
  message?: string;
};

export type SearchResponse = {
  success: boolean;
  live: boolean;
  rows: StockCheckItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  queryTooShort?: boolean;
  lastSuccessfulCheck?: string | null;
  message?: string;
};

export class StockCheckApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "StockCheckApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message || "تعذر تنفيذ الطلب.")
        : "تعذر تنفيذ الطلب.";
    throw new StockCheckApiError(message, response.status, payload);
  }

  return payload as T;
}

export function getSession() {
  return request<SessionResponse>("/api/stock-check/session");
}

export function login(pin: string) {
  return request<SessionResponse>("/api/stock-check/login", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export function logout() {
  return request<SessionResponse>("/api/stock-check/logout", { method: "POST" });
}

export function getStatus() {
  return request<StatusResponse>("/api/stock-check/status");
}

export function searchStock(query: string, page = 1, pageSize = 20) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<SearchResponse>(`/api/stock-check/search?${params.toString()}`);
}

export function fetchInventoryPage(page = 1, pageSize = 200) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<SearchResponse>(`/api/stock-check/inventory?${params.toString()}`);
}
