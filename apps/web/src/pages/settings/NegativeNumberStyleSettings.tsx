import { useMutation } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { toast } from "sonner";

import { apiClient, getApiErrorMessage } from "@/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { NegativeNumberStyle } from "@/lib/amount";

export function NegativeNumberStyleSettings({ companyId }: { companyId: string }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { companies, refresh } = useCompany();
  const current = companies.find((c) => c.id === companyId)?.negativeNumberStyle ?? NegativeNumberStyle.Parentheses;

  const save = useMutation({
    mutationFn: (style: number) => apiClient.updateCompanyNegativeNumberStyle(companyId, { negativeNumberStyle: style }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("company.negativeStyle.saved"));
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, t("company.negativeStyle.saveError"))),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("company.negativeStyle.title")}</CardTitle>
        <CardDescription>{t("company.negativeStyle.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Label>{t("company.negativeStyle.label")}</Label>
        <Select
          value={String(current)}
          onValueChange={(v) => save.mutate(Number(v))}
          options={[
            { value: String(NegativeNumberStyle.Parentheses), label: t("company.negativeStyle.parentheses") },
            { value: String(NegativeNumberStyle.MinusSign), label: t("company.negativeStyle.minus") },
          ]}
          disabled={save.isPending}
          className="w-56"
        />
      </CardContent>
    </Card>
  );
}
