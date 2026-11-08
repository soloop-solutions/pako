import { fireEvent, screen } from "@testing-library/react";

export async function chooseOption(trigger: HTMLElement, optionName: string | RegExp): Promise<void> {
  fireEvent.click(trigger);
  fireEvent.mouseDown(await screen.findByRole("option", { name: optionName }));
}
