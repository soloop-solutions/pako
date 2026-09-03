import { useIntl } from "react-intl";

import { Select } from "@/components/ui/select";
import { useLocale } from "@/i18n/IntlProviderWrapper";

export function LanguageSwitcher() {
  const intl = useIntl();
  const { locale, setLocale } = useLocale();

  return (
    <Select
      aria-label={intl.formatMessage({ id: "language.label" })}
      className="h-8 w-24"
      value={locale}
      onChange={(event) => setLocale(event.target.value)}
    >
      <option value="en">{intl.formatMessage({ id: "language.english" })}</option>
      <option value="sq">{intl.formatMessage({ id: "language.albanian" })}</option>
    </Select>
  );
}
