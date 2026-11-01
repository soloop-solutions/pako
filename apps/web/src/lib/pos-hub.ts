import { useEffect, useRef } from "react";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";

import { API_BASE_URL } from "@/api/client";
import { getStoredAuth } from "@/lib/auth-storage";

// docs/POS_PLAN.md P3: the store's live channel (backend Hubs/PosHub.cs). The hub carries no data:
// "tickets" and "tabs" only say something changed, and the screen reads it again through the
// ordinary endpoints. Browsers can't set headers on a WebSocket, so the JWT goes as access_token.
export type PosHubEvent = "tickets" | "tabs";

export function usePosHub(companyId: string | undefined, storeId: string | undefined, handlers: Partial<Record<PosHubEvent, () => void>>) {
  // The latest handlers, so a re-render doesn't reconnect.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!companyId || !storeId) return;
    const connection = new HubConnectionBuilder()
      .withUrl(`${API_BASE_URL}/hubs/pos`, { accessTokenFactory: () => getStoredAuth()?.token ?? "" })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
    connection.on("tickets", () => latest.current.tickets?.());
    connection.on("tabs", () => latest.current.tabs?.());
    const join = () => connection.invoke("JoinStore", companyId, storeId);
    // After a reconnect the server has forgotten the group, and what changed meanwhile was missed.
    connection.onreconnected(() => {
      void join().catch(() => undefined);
      latest.current.tickets?.();
      latest.current.tabs?.();
    });
    let stopped = false;
    connection
      .start()
      .then(() => (stopped ? undefined : join()))
      .catch(() => undefined); // Polling covers a hub that can't be reached.
    return () => {
      stopped = true;
      void connection.stop().catch(() => undefined);
    };
  }, [companyId, storeId]);
}
