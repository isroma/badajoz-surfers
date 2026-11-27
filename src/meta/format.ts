/**
 * Spanish (Spain) number formatting. `Intl` with "es-ES" does not group 4-digit numbers
 * (1234 stays "1234"), but the game always wants "1.234", so grouping is done by hand.
 */
export function formatInt(value: number): string {
  const n = Number.isFinite(value) ? Math.floor(Math.abs(value)) : 0;
  const digits = String(n);
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return value < 0 && n > 0 ? `-${out}` : out;
}

/** "350 m" with Spanish grouping. */
export function formatMetres(value: number): string {
  return `${formatInt(value)} m`;
}

/** Seconds with at most one decimal and a comma: "12 s", "12,5 s". */
export function formatSeconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} s`;
}
