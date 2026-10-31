import type { ComponentProps } from "react";
import { useNavigate } from "react-router-dom";

import { ROW_LINK_CLASS, rowLinkProps } from "@/components/data-grid/rowLink";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function LinkedRow({ to, className, ...props }: Omit<ComponentProps<typeof TableRow>, "onClick"> & { to: string | null | undefined }) {
  const navigate = useNavigate();
  if (!to) return <TableRow className={className} {...props} />;
  return <TableRow {...props} {...rowLinkProps(to, navigate)} className={cn(ROW_LINK_CLASS, className)} />;
}
