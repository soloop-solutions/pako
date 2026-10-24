import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import type { MemberResponse, NumberSeriesResponse } from "@pako/shared";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { numberSeriesDocumentTypeLabel } from "@/lib/document-types";
import { isCompanyAdminRole } from "@/lib/membership-enums";

interface NumberingSettingsProps {
  companyId: string;
}

/** Formats a pattern preview using the same placeholders the backend resolves. */
function previewPattern(pattern: string, nextValue: number): string {
  let result = pattern;

  const seqMatch = result.match(/\{seq:D(\d+)\}/);
  if (seqMatch) {
    const padding = parseInt(seqMatch[1], 10);
    result = result.replace(seqMatch[0], String(nextValue).padStart(padding, "0"));
  } else {
    result = result.replace("{seq}", String(nextValue));
  }

  const now = new Date();
  result = result.replace("{yyyy}", String(now.getFullYear()));
  result = result.replace("{mm}", String(now.getMonth() + 1).padStart(2, "0"));
  result = result.replace("{dd}", String(now.getDate()).padStart(2, "0"));

  return result;
}

// F7: pattern per document type/year, editable inline per row. NumberSeries rows are created
// lazily by the backend the first time a document of that type/year is actually numbered (see
// NumberSeriesService — there is no "create a series ahead of time" endpoint), so a fresh company
// legitimately shows an empty list until it posts its first document of each type.
export function NumberingSettings({ companyId }: NumberingSettingsProps) {
  const intl = useIntl();
  const { auth } = useAuth();
  const queryClient = useQueryClient();

  const seriesQueryKey = ["numberSeries", companyId] as const;

  const seriesQuery = useQuery({
    queryKey: seriesQueryKey,
    queryFn: () => apiClient.numberSeriesAll(companyId),
  });

  const membersQuery = useQuery({
    queryKey: ["members", "company", companyId],
    queryFn: () => apiClient.membersAll(companyId),
  });

  const members = membersQuery.data ?? [];
  const currentMembership = members.find((m: MemberResponse) => m.userId === auth?.userId);
  const isAdmin = currentMembership ? isCompanyAdminRole(currentMembership.role) : false;

  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [patternDraft, setPatternDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const editingSeries = useMemo(
    () => (seriesQuery.data ?? []).find((s) => s.id === editingSeriesId),
    [seriesQuery.data, editingSeriesId],
  );

  function startEditing(series: NumberSeriesResponse) {
    setEditingSeriesId(series.id);
    setPatternDraft(series.pattern);
    setRowError(null);
  }

  function cancelEditing() {
    setEditingSeriesId(null);
    setPatternDraft("");
    setRowError(null);
  }

  function applyQuickFormat(format: "dateCounter" | "prefixCounter") {
    if (format === "dateCounter") {
      setPatternDraft("{yyyy}{mm}{dd}-{seq:D4}");
    } else {
      // Extract a reasonable prefix from the current pattern or use the document type
      const existingPrefix = patternDraft.match(/^([A-Z]{2,6})-/)?.[1];
      const prefix = existingPrefix ?? "INV";
      setPatternDraft(`${prefix}-{seq:D6}`);
    }
  }

  async function handleSave(event: FormEvent, seriesId: string) {
    event.preventDefault();
    setRowError(null);
    setSaving(true);
    try {
      const updated = await apiClient.numberSeries(companyId, seriesId, { pattern: patternDraft });
      queryClient.setQueryData<NumberSeriesResponse[]>(seriesQueryKey, (prev) =>
        (prev ?? []).map((s) => (s.id === updated.id ? updated : s)),
      );
      setEditingSeriesId(null);
      setPatternDraft("");
    } catch (err) {
      setRowError(getApiErrorMessage(err, intl.formatMessage({ id: "numbering.saveError" })));
    } finally {
      setSaving(false);
    }
  }

  const series = seriesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{intl.formatMessage({ id: "numbering.title" })}</CardTitle>
        <CardDescription>{intl.formatMessage({ id: "numbering.description" })}</CardDescription>
      </CardHeader>
      <CardContent>
        {seriesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "numbering.loading" })}</p>
        ) : seriesQuery.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{getApiErrorMessage(seriesQuery.error, intl.formatMessage({ id: "numbering.loadError" }))}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{intl.formatMessage({ id: "numbering.documentType" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "numbering.year" })}</TableHead>
                  <TableHead>{intl.formatMessage({ id: "numbering.pattern" })}</TableHead>
                  <TableHead className="text-right">{intl.formatMessage({ id: "numbering.nextValue" })}</TableHead>
                  {isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{numberSeriesDocumentTypeLabel(s.documentType, intl)}</TableCell>
                    <TableCell className="tabular-nums">{s.year}</TableCell>
                    <TableCell>
                      {editingSeriesId === s.id ? (
                        <form className="flex flex-col gap-2" onSubmit={(event) => void handleSave(event, s.id)}>
                          {/* Quick format buttons */}
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">{intl.formatMessage({ id: "numbering.quickFormat" })}:</span>
                            <Button
                              type="button"
                              size="sm"
                              variant={patternDraft.includes("{dd}") ? "default" : "outline"}
                              className="h-6 text-xs"
                              onClick={() => applyQuickFormat("dateCounter")}
                            >
                              {intl.formatMessage({ id: "numbering.formatA" })}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={!patternDraft.includes("{dd}") && patternDraft.includes("{seq") ? "default" : "outline"}
                              className="h-6 text-xs"
                              onClick={() => applyQuickFormat("prefixCounter")}
                            >
                              {intl.formatMessage({ id: "numbering.formatB" })}
                            </Button>
                          </div>

                          <Input
                            value={patternDraft}
                            onChange={(event) => setPatternDraft(event.target.value)}
                            maxLength={64}
                            required
                          />

                          {/* Live preview */}
                          {patternDraft.includes("{seq") && (
                            <p className="text-xs tabular-nums">
                              {intl.formatMessage({ id: "numbering.nextValue" })}:{" "}
                              <span className="font-medium">{previewPattern(patternDraft, editingSeries?.nextValue ?? 1)}</span>
                            </p>
                          )}

                          <p className="text-xs text-muted-foreground">
                            {patternDraft.includes("{dd}")
                              ? intl.formatMessage({ id: "numbering.formatAHint" })
                              : !patternDraft.includes("{yyyy}") && !patternDraft.includes("{dd}")
                                ? intl.formatMessage({ id: "numbering.formatBHint" })
                                : intl.formatMessage(
                                    { id: "numbering.patternHint" },
                                    { seqExample: "{seq}", seqFormatExample: "{seq:D4}", yyyyExample: "{yyyy}", mmExample: "{mm}", ddExample: "{dd}" },
                                  )}
                          </p>

                          {rowError && <p className="text-xs text-destructive">{rowError}</p>}
                          <div className="flex items-center gap-2">
                            <Button type="submit" size="sm" disabled={saving || !patternDraft.trim()}>
                              {saving ? intl.formatMessage({ id: "numbering.saving" }) : intl.formatMessage({ id: "numbering.save" })}
                            </Button>
                            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={cancelEditing}>
                              {intl.formatMessage({ id: "numbering.cancel" })}
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <span className="tabular-nums">{s.pattern}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.nextValue}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        {editingSeriesId !== s.id && (
                          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => startEditing(s)}>
                            {intl.formatMessage({ id: "numbering.edit" })}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {series.length === 0 && <p className="text-sm text-muted-foreground">{intl.formatMessage({ id: "numbering.empty" })}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
