import type { PosOrderRequest } from "@pako/shared";
import { apiClient } from "@/api/client";

const STORAGE_KEY = "pako.pos.offlineQueue";

export interface QueuedOrder {
  clientUuid: string;
  companyId: string;
  request: PosOrderRequest;
  queuedAt: string;
}

function load(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(orders: QueuedOrder[]): void {
  try {
    if (orders.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch { /* quota exceeded — the queue is in-memory anyway */ }
}

/** Enqueue an order that couldn't reach the backend. */
export function enqueueOfflineOrder(companyId: string, request: PosOrderRequest): void {
  const queue = load();
  // Deduplicate by clientUuid (idempotent)
  if (queue.some((o) => o.clientUuid === request.clientUuid)) return;
  queue.push({ clientUuid: request.clientUuid, companyId, request, queuedAt: new Date().toISOString() });
  save(queue);
  notify();
}

/** Remove a successfully synced order from the queue. */
function dequeue(clientUuid: string): void {
  save(load().filter((o) => o.clientUuid !== clientUuid));
}

/** All orders waiting to sync. */
export function getPendingOrders(): QueuedOrder[] {
  return load();
}

/** Submit all queued orders to the backend. Returns the number successfully synced. */
export async function syncOfflineOrders(): Promise<{ synced: number; failed: number }> {
  const queue = load();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const order of queue) {
    try {
      await apiClient.submitPosOrder(order.companyId, order.request);
      dequeue(order.clientUuid);
      synced++;
    } catch {
      // Network error → leave in queue for next attempt.
      // 4xx (bad data) → also leave — a human needs to look at it.
      failed++;
    }
  }

  notify();
  return { synced, failed };
}

// Simple pub/sub so components can react to queue changes.
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
