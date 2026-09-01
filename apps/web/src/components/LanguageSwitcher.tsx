import { useTranslation } from "react-i18next";

import { Select } from "@/components/ui/select";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation("common");

  return (
    <Select
      aria-label={t("language")}
      className="h-8 w-24"
      value={i18n.resolvedLanguage ?? "en"}
      onChange={(event) => void i18n.changeLanguage(event.target.value)}
    >
      <option value="en">{t("english")}</option>
      <option value="sq">{t("albanian")}</option>
    </Select>
  );
}
