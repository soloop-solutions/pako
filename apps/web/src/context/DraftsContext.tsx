import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

export type FormDraft = {
  id: string;
  kind: string;
  title: string;
  path: string;
  savedAt: number;
  state: unknown;
};

type DraftsContextValue = {
  drafts: FormDraft[];
  resumeRequest: FormDraft | null;
  saveDraft: (draft: Omit<FormDraft, "id" | "savedAt">) => void;
  discardDraft: (id: string) => void;
  requestResume: (id: string) => FormDraft | null;
  consumeResume: (kind: string) => FormDraft | null;
};

const DraftsContext = createContext<DraftsContextValue | null>(null);

function storageKey(userId: string, companyId: string): string {
  return `pako.drafts.${userId}.${companyId}`;
}

function readDrafts(key: string | null): FormDraft[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as FormDraft[]) : [];
  } catch {
    return [];
  }
}

function writeDrafts(key: string | null, drafts: FormDraft[]): void {
  if (!key) return;
  try {
    if (drafts.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    return;
  }
}

export function DraftsProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const { activeCompanyId } = useCompany();
  const userId = auth?.userId ?? null;
  const key = userId && activeCompanyId ? storageKey(userId, activeCompanyId) : null;
  const [state, setState] = useState<{ key: string | null; drafts: FormDraft[] }>(() => ({ key, drafts: readDrafts(key) }));
  const [resumeRequest, setResumeRequest] = useState<FormDraft | null>(null);
  const draftsRef = useRef<FormDraft[]>(state.drafts);
  const resumeRequestRef = useRef<FormDraft | null>(null);

  useEffect(() => {
    if (state.key === key) return;
    const next = readDrafts(key);
    draftsRef.current = next;
    setState({ key, drafts: next });
    setResumeRequest(null);
  }, [key, state.key]);

  const commit = useCallback(
    (next: FormDraft[]) => {
      draftsRef.current = next;
      writeDrafts(key, next);
      setState({ key, drafts: next });
    },
    [key],
  );

  const saveDraft = useCallback(
    (draft: Omit<FormDraft, "id" | "savedAt">) => {
      const others = draftsRef.current.filter((d) => d.kind !== draft.kind);
      commit([...others, { ...draft, id: `${draft.kind}-${Date.now()}`, savedAt: Date.now() }]);
    },
    [commit],
  );

  const discardDraft = useCallback(
    (id: string) => {
      commit(draftsRef.current.filter((d) => d.id !== id));
      if (resumeRequestRef.current?.id === id) resumeRequestRef.current = null;
      setResumeRequest((prev) => (prev?.id === id ? null : prev));
    },
    [commit],
  );

  const requestResume = useCallback(
    (id: string) => {
      const draft = draftsRef.current.find((d) => d.id === id) ?? null;
      if (draft) {
        resumeRequestRef.current = draft;
        setResumeRequest(draft);
      }
      return draft;
    },
    [],
  );

  const consumeResume = useCallback(
    (kind: string) => {
      const draft = resumeRequestRef.current;
      if (!draft || draft.kind !== kind) return null;
      resumeRequestRef.current = null;
      setResumeRequest(null);
      commit(draftsRef.current.filter((d) => d.id !== draft.id));
      return draft;
    },
    [commit],
  );

  const value = useMemo(
    () => ({ drafts: state.drafts, resumeRequest, saveDraft, discardDraft, requestResume, consumeResume }),
    [state.drafts, resumeRequest, saveDraft, discardDraft, requestResume, consumeResume],
  );

  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDrafts(): DraftsContextValue {
  const ctx = useContext(DraftsContext);
  if (!ctx) throw new Error("useDrafts must be used within a DraftsProvider");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalDrafts(): DraftsContextValue | null {
  return useContext(DraftsContext);
}
