import { useEffect } from "react";

export function useClampPage(
  grid: { page: number; pageSize: number; setPage: (page: number) => void },
  total: number | undefined,
  settled: boolean,
) {
  useEffect(() => {
    if (total === undefined || !settled) return;
    const lastPage = Math.max(1, Math.ceil(total / grid.pageSize));
    if (grid.page > lastPage) grid.setPage(lastPage);
  }, [grid, total, settled]);
}
