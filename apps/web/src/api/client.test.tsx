import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { useLocale } from "@/i18n/useLocale";

import { apiClient } from "./client";

function LocaleSwitch() {
  const { setLocale } = useLocale();
  return <button onClick={() => setLocale("sq")}>switch</button>;
}

describe("apiClient Accept-Language", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentLanguage(): string | null {
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    return new Headers(init.headers).get("Accept-Language");
  }

  it("sends en by default", async () => {
    await apiClient.trialBalance("c1", undefined, undefined);
    expect(sentLanguage()).toBe("en");
  });

  it("sends sq after the UI locale is switched to sq", async () => {
    render(
      <IntlProviderWrapper>
        <LocaleSwitch />
      </IntlProviderWrapper>,
    );
    await act(async () => {
      screen.getByText("switch").click();
    });
    await apiClient.trialBalance("c1", undefined, undefined);
    expect(sentLanguage()).toBe("sq");
  });
});
