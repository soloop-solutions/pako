import { authorizedFetch, API_BASE_URL } from "@/api/client";

export interface MonthLockResponse {
  year: number;
  month: number;
  isLocked: boolean;
  lockedByUserId: string | null;
  lockedByEmail: string | null;
  lockedAt: string | null;
}

export interface MonthLockYearResponse {
  year: number;
  months: MonthLockResponse[];
}

export interface MonthLockEventResponse {
  id: string;
  year: number;
  month: number;
  action: number; // 0 = Lock, 1 = Unlock
  userId: string;
  userEmail: string | null;
  timestamp: string;
  reason: string | null;
}

export interface MonthLockHistoryResponse {
  items: MonthLockEventResponse[];
  total: number;
  page: number;
  pageSize: number;
}

const BASE = API_BASE_URL;

export const monthLocksClient = {
  async getYear(companyId: string, year: number): Promise<MonthLockYearResponse> {
    const res = await authorizedFetch(`${BASE}/api/companies/${companyId}/month-locks?year=${year}`);
    if (!res.ok) throw await toError(res);
    return res.json();
  },

  async lock(companyId: string, year: number, months: number[]): Promise<MonthLockYearResponse> {
    const res = await authorizedFetch(`${BASE}/api/companies/${companyId}/month-locks/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, months }),
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },

  async unlock(companyId: string, year: number, month: number, reason: string): Promise<MonthLockYearResponse> {
    const res = await authorizedFetch(`${BASE}/api/companies/${companyId}/month-locks/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, reason }),
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  },

  async history(companyId: string, year?: number, page = 1, pageSize = 50): Promise<MonthLockHistoryResponse> {
    const params = new URLSearchParams();
    if (year != null) params.set("year", String(year));
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const res = await authorizedFetch(`${BASE}/api/companies/${companyId}/month-locks/history?${params}`);
    if (!res.ok) throw await toError(res);
    return res.json();
  },
};

async function toError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  return new Error(text || `HTTP ${res.status}`);
}
