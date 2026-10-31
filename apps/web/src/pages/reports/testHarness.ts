import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

import { Reports } from "./ReportsPage";

function LocationProbe() {
  const location = useLocation();
  return createElement("div", { "data-testid": "location" }, location.search);
}

function RouteProbe() {
  const location = useLocation();
  return createElement("div", { "data-testid": "route" }, location.pathname + location.search);
}

export function renderReports(initialEntry: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(
        IntlProviderWrapper,
        null,
        createElement(QueryClientProvider, { client: queryClient }, createElement(Reports), createElement(LocationProbe), createElement(RouteProbe)),
      ),
    ),
  );
}

export function fileResponse(name: string) {
  return { data: new Blob(["x"]), status: 200, fileName: name };
}
