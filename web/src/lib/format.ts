export function formatUsdc(amount: bigint): string {
  const decimals = 6n;
  const divisor = 10n ** decimals;
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) return `${whole.toString()} USDC`;

  const fractionString = fraction.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionString} USDC`;
}

export function formatTimestamp(value: bigint): string {
  if (value === 0n) return "Not set";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Number(value) * 1000);
}
