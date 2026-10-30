import { Moon, Sun } from "lucide-react";
import { useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";

// Light/dark switch shared by the app's top bar, the company list and the administration panel.
export function ThemeToggleButton() {
  const intl = useIntl();
  const { theme, toggle } = useTheme();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={intl.formatMessage({ id: theme === "dark" ? "common.theme.light" : "common.theme.dark" })}
      onClick={toggle}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
