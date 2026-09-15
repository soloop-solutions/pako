import { useState, type FormEvent } from "react";
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
                        <form className="flex flex-col gap-1" onSubmit={(event) => void handleSave(event, s.id)}>
                          <Input
                            value={patternDraft}
                            onChange={(event) => setPatternDraft(event.target.value)}
                            maxLength={64}
                            required
                          />
                          <p className="text-xs text-muted-foreground">
                            {intl.formatMessage(
                              { id: "numbering.patternHint" },
                              { seqExample: "{seq}", seqFormatExample: "{seq:D4}", yyyyExample: "{yyyy}", mmExample: "{mm}" },
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
