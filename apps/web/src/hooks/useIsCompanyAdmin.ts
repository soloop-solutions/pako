import { useMyAccess } from "@/hooks/useMyAccess";

export function useIsCompanyAdmin(companyId: string | null | undefined): { isAdmin: boolean; isLoading: boolean } {
  const { access, isLoading } = useMyAccess();
  return {
    isAdmin: access?.isAdmin ?? false,
    isLoading: !!companyId && isLoading,
  };
}
