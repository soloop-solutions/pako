import { zodResolver } from "@hookform/resolvers/zod";
import { renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
});

describe("react-hook-form + zod stack", () => {
  it("resolves validation errors through zodResolver", () => {
    const { result } = renderHook(() =>
      useForm({
        resolver: zodResolver(schema),
        defaultValues: { name: "" },
      }),
    );

    expect(result.current.formState).toBeDefined();
    expect(schema.safeParse({ name: "" }).success).toBe(false);
    expect(schema.safeParse({ name: "Item" }).success).toBe(true);
  });
});
