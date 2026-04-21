import { createPublicClient, http } from "viem";

import { configuredChain } from "./chains.js";
import { backendConfig } from "./config.js";

export const publicClient = createPublicClient({
  chain: configuredChain,
  transport: http(backendConfig.rpcUrl),
});
