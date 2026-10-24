import { useIntl } from "react-intl";

import { Select } from "@/components/ui/select";
import { useLocale } from "@/i18n/useLocale";

export function LanguageSwitcher() {
  const intl = useIntl();
  const { locale, setLocale } = useLocale();

  return (
    <Select
      aria-label={intl.formatMessage({ id: "language.label" })}
      className="h-8 w-24"
      value={locale}
      onValueChange={setLocale}
      options={[
        { value: "en", label: intl.formatMessage({ id: "language.english" }) },
        { value: "sq", label: intl.formatMessage({ id: "language.albanian" }) },
      ]}
    />
  );
}
