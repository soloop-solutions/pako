import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  /** Label text */
  label?: string;
  /** HTML id for the input — also used for Label's htmlFor */
  htmlFor?: string;
  /** Error message to display below the input */
  error?: string | null;
  /** Whether the field is required (appends " *" to label) */
  required?: boolean;
  /** Hint text below the input (hidden when error is shown) */
  hint?: string;
  /** Additional class names on the wrapper */
  className?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, required, hint, className, children }: FormFieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? " *" : ""}
        </Label>
      )}
      {children}
      {error ? (
        <p id={errorId} className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
