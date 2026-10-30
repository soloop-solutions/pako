import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/context/ThemeContext";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IntlProviderWrapper>
      <ThemeProvider>
        <App />
        {/* App-wide, so a toast raised on one screen (e.g. the lobby) survives the navigation. */}
        <Toaster />
      </ThemeProvider>
    </IntlProviderWrapper>
  </StrictMode>,
);
