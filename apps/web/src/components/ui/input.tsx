import * as React from "react";

import { DatePicker, MonthPicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input">;

function pickerEvent(props: InputProps, value: string): React.ChangeEvent<HTMLInputElement> {
  const target = { value, id: props.id ?? "", name: props.name ?? "" };
  return { target, currentTarget: target } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function PickerInput({ type, ...props }: InputProps & { type: "date" | "month" }) {
  const controlled = props.value !== undefined;
  const [inner, setInner] = React.useState(String(props.defaultValue ?? ""));
  const value = controlled ? String(props.value) : inner;

  function change(next: string) {
    if (!controlled) setInner(next);
    props.onChange?.(pickerEvent(props, next));
  }

  const shared = {
    value,
    id: props.id,
    disabled: props.disabled,
    required: props.required,
    min: props.min as string | undefined,
    max: props.max as string | undefined,
    className: props.className,
    "aria-label": props["aria-label"],
  };

  if (type === "month") {
    return <MonthPicker {...shared} onValueChange={change} />;
  }
  return (
    <DatePicker
      {...shared}
      name={props.name}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      aria-labelledby={props["aria-labelledby"]}
      aria-invalid={props["aria-invalid"] === true || props["aria-invalid"] === "true"}
      aria-describedby={props["aria-describedby"]}
      onValueChange={change}
    />
  );
}

function Input({ className, type, ...props }: InputProps) {
  if (type === "date" || type === "month") {
    return <PickerInput type={type as "date" | "month"} className={className} {...props} />;
  }
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-0 text-[12.5px] transition-colors outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
