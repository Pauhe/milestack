import { keccak256, stringToHex } from "viem";

export function hashJson(value: unknown): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(value)));
}
