import { useTheme } from "@/context/ThemeContext";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        className: "text-sm",
      }}
      richColors
      closeButton
    />
  );
}
