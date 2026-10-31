import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

export function EntityLink({ to, className, onClick, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      to={to}
      className={cn("text-primary underline-offset-2 hover:underline", className)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onAuxClick={(event) => event.stopPropagation()}
      {...props}
    />
  );
}

export function MaybeEntityLink({ to, children }: { to: string | null | undefined; children: ReactNode }) {
  return to ? <EntityLink to={to}>{children}</EntityLink> : <>{children}</>;
}
