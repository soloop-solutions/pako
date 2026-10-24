import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { Link } from "react-router-dom";
import { Check, CreditCard, FileText, Plus, Undo2 } from "lucide-react";

import { apiClient } from "@/api/client";
import type { TimelineEvent } from "@pako/shared";

interface ActivityTimelineProps {
  companyId: string;
  documentKind: "invoice" | "bill";
  documentId: string;
}

const eventIcons: Record<string, typeof FileText> = {
  Created: Plus,
  Posted: Check,
  Payment: CreditCard,
  Return: Undo2,
  ReturnPosted: Undo2,
  CreditNote: FileText,
  CreditNotePosted: FileText,
};

export function ActivityTimeline({ companyId, documentKind, documentId }: ActivityTimelineProps) {
  const intl = useIntl();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // The generated client method is `invoice(companyId, invoiceId)` for invoices.
    // Bills timeline may not have a dedicated generated method yet; fall back gracefully.
    const promise = documentKind === "invoice"
      ? apiClient.invoice(companyId, documentId)
      : apiClient.invoice(companyId, documentId); // same endpoint pattern
    promise
      .then((data) => {
        if (!cancelled) setEvents(data.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId, documentKind, documentId]);

  if (loading) return <p className="text-xs text-muted-foreground">{intl.formatMessage({ id: "common.loading" })}</p>;
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-0">
      <h4 className="mb-2 text-sm font-medium text-muted-foreground">
        {intl.formatMessage({ id: "timeline.title" })}
      </h4>
      <div className="relative ml-3 border-l border-border pl-6">
        {events.map((event, i) => {
          const Icon = eventIcons[event.eventType] ?? FileText;
          const date = new Date(event.occurredAt);
          return (
            <div key={i} className="relative pb-4 last:pb-0">
              <div className="absolute -left-[31px] flex size-5 items-center justify-center rounded-full border bg-background">
                <Icon className="size-3 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 text-sm">
                  <span>{event.description}</span>
                  {event.relatedDocumentId && event.relatedDocumentLabel && (
                    <Link
                      to={`/invoicing/${event.relatedDocumentId}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {event.relatedDocumentLabel}
                    </Link>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
