import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PeriodPresetSelect } from "@/components/list/PeriodPresetSelect";
import { IntlProviderWrapper } from "@/i18n/IntlProviderWrapper";
import { datePresetRange } from "@/lib/date-presets";
import { chooseOption } from "@/test/chooseOption";

describe("PeriodPresetSelect", () => {
  it("sets both ends of the range from a preset and shows the matching one", async () => {
    const onChange = vi.fn();
    const [from, to] = datePresetRange("thisYear");
    render(
      <IntlProviderWrapper>
        <PeriodPresetSelect id="p" from={from} to={to} onChange={onChange} />
      </IntlProviderWrapper>,
    );
    const select = screen.getByRole("combobox", { name: "Period" });
    expect(select).toHaveTextContent("This year");

    await chooseOption(select, "Last month");
    expect(onChange).toHaveBeenCalledWith(...datePresetRange("lastMonth"));
  });
});
