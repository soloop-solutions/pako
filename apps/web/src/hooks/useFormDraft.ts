import { useEffect, useRef } from "react";

import { useOptionalDrafts } from "@/context/DraftsContext";

type Options<T> = {
  kind: string;
  title: string;
  enabled?: boolean;
  dirty: boolean;
  getState: () => T;
  restore: (state: T) => void;
};

export function useFormDraft<T>({ kind, title, enabled = true, dirty, getState, restore }: Options<T>) {
  const drafts = useOptionalDrafts();
  const path = useRef(window.location.pathname + window.location.search);
  const latest = useRef({ dirty, getState, restore, title, path: path.current, drafts });
  latest.current = { dirty, getState, restore, title, path: path.current, drafts };
  const done = useRef(false);

  const resumeRequest = drafts?.resumeRequest ?? null;
  useEffect(() => {
    if (!enabled || !resumeRequest || resumeRequest.kind !== kind) return;
    const draft = latest.current.drafts?.consumeResume(kind);
    if (draft) latest.current.restore(draft.state as T);
  }, [enabled, kind, resumeRequest]);

  useEffect(() => {
    done.current = false;
    return () => {
      const current = latest.current;
      if (!enabled || done.current || !current.dirty || !current.drafts) return;
      current.drafts.saveDraft({ kind, title: current.title, path: current.path, state: current.getState() });
    };
  }, [enabled, kind]);

  return {
    markDone: () => {
      done.current = true;
    },
  };
}
