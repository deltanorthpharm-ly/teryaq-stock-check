import type { StockCheckItem } from "./stockCheckApi";

const DB_NAME = "teryaq-stock-check-cache";
const DB_VERSION = 1;
const STORE_NAME = "inventory";
const CACHE_KEY = "safe-inventory";

export type StockCheckInventoryCache = {
  items: StockCheckItem[];
  totalCount: number;
  lastSuccessfulSync: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open local stock cache."));
  });
}

function sanitizeItem(item: StockCheckItem): StockCheckItem {
  return {
    itemCode: item.itemCode ?? null,
    name: String(item.name || ""),
    barcode: item.barcode ?? null,
    sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
    quantity: Number(item.quantity || 0),
    formattedQuantity: String(item.formattedQuantity || ""),
    unit: item.unit ?? null,
    availability: item.availability === "available" ? "available" : "unavailable",
  };
}

export async function loadStockCheckCache(): Promise<StockCheckInventoryCache | null> {
  if (typeof indexedDB === "undefined") return null;

  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY);

      request.onsuccess = () => {
        const value = request.result as StockCheckInventoryCache | undefined;
        if (!value || !Array.isArray(value.items) || !value.lastSuccessfulSync) {
          resolve(null);
          return;
        }
        resolve({
          items: value.items.map(sanitizeItem),
          totalCount: Number(value.totalCount || value.items.length),
          lastSuccessfulSync: value.lastSuccessfulSync,
        });
      };
      request.onerror = () => reject(request.error || new Error("Unable to read local stock cache."));
    });
  } finally {
    database.close();
  }
}

export async function saveStockCheckCache(payload: StockCheckInventoryCache): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const request = transaction.objectStore(STORE_NAME).put(
        {
          items: payload.items.map(sanitizeItem),
          totalCount: Number(payload.totalCount || payload.items.length),
          lastSuccessfulSync: payload.lastSuccessfulSync,
        },
        CACHE_KEY,
      );

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("Unable to update local stock cache."));
    });
  } finally {
    database.close();
  }
}
