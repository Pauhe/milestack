import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

import { configuredChain } from "@/lib/chains";

export const wagmiConfig = createConfig({
  chains: [configuredChain],
  connectors: [injected()],
  transports: {
    [configuredChain.id]: http(),
  },
  ssr: true,
});
