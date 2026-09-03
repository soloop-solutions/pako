import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IntlProviderWrapper>
      <App />
    </IntlProviderWrapper>
  </StrictMode>,
);
