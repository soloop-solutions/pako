import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "@/App";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";

describe("App", () => {
  it("redirects unauthenticated users to the login screen", () => {
    render(
      <IntlProviderWrapper>
        <App />
      </IntlProviderWrapper>,
    );

    expect(screen.getByText("Log in to PAKO")).toBeInTheDocument();
  });
});
