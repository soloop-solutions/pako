import { FileClock, X } from "lucide-react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useDrafts } from "@/context/DraftsContext";

export function DraftsRibbon() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { drafts, requestResume, discardDraft } = useDrafts();
  if (drafts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label={intl.formatMessage({ id: "drafts.ribbon" })}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted px-4 py-1.5 text-[12.5px] lg:px-6"
      data-testid="drafts-ribbon"
    >
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <FileClock className="size-3.5" />
        {intl.formatMessage({ id: "drafts.ribbon" })}
      </span>
      {drafts.map((draft) => (
        <span key={draft.id} className="flex items-center gap-1.5">
          <span className="font-medium">{draft.title}</span>
          <span className="text-muted-foreground">{intl.formatDate(draft.savedAt, { dateStyle: "short", timeStyle: "short" })}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[12px]"
            onClick={() => {
              const found = requestResume(draft.id);
              if (found) navigate(found.path);
            }}
          >
            {intl.formatMessage({ id: "drafts.resume" })}
          </Button>
          <button
            type="button"
            aria-label={intl.formatMessage({ id: "drafts.discard" })}
            title={intl.formatMessage({ id: "drafts.discard" })}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => discardDraft(draft.id)}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
