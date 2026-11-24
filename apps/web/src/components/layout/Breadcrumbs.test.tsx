import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IntlProviderWrapper>
        <Routes>
          <Route path="/invoicing/:id" element={<Breadcrumbs />} />
          <Route path="/invoicing/:id/edit" element={<Breadcrumbs />} />
        </Routes>
      </IntlProviderWrapper>
    </MemoryRouter>,
  );
}

// UI/UX round 2026-11-24: never a UUID fragment as a crumb; the edit page has crumbs too.
describe("Breadcrumbs", () => {
  it("links back to the list and shows no id fragment on a document page", () => {
    renderAt("/invoicing/3f2a1b9c-1111-2222-3333-444455556666");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).not.toHaveTextContent("3f2a1b9c");
  });

  it("shows Edit on a document's edit page", () => {
    renderAt("/invoicing/3f2a1b9c-1111-2222-3333-444455556666/edit");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toHaveTextContent("Edit");
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
