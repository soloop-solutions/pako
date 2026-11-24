import { render, screen } from "@testing-library/react";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { DocumentStateBadge } from "@/components/shared/DocumentStateBadge";
import { messages } from "@/i18n/messages";

describe("DocumentStateBadge", () => {
  it("shows the state in the user's language", () => {
    render(
      <IntlProvider locale="sq" messages={messages.sq}>
        <DocumentStateBadge state="Posted" />
        <DocumentStateBadge state="Cancelled" />
      </IntlProvider>,
    );
    expect(screen.getByText("Postuar")).toBeInTheDocument();
    expect(screen.getByText("Anuluar")).toBeInTheDocument();
  });
});
