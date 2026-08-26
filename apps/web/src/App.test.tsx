import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "@/App";

describe("App", () => {
  it("redirects unauthenticated users to the login screen", () => {
    render(<App />);

    expect(screen.getByText("Log in to PAKO")).toBeInTheDocument();
  });
});
