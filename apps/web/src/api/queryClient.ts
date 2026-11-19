import { MutationCache, QueryClient } from "@tanstack/react-query";

import { isLicenseReadOnlyError } from "@/api/client";
import { LICENSE_KEY } from "@/pages/desktop/useDesktopLicense";

export function createAppQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isLicenseReadOnlyError(error)) void queryClient.invalidateQueries({ queryKey: LICENSE_KEY });
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  return queryClient;
}
