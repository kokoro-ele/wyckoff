/** Decodes literal `\uXXXX` sequences returned by some quote/search feeds. */
export function decodeUnicodeEscapes(value: string): string {
  if (!value || !value.includes("\\u")) return value;
  let result = value;
  // Some upstreams double-escape their GBK/UTF-8 payloads.
  for (let pass = 0; pass < 2 && result.includes("\\u"); pass += 1) {
    result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
  return result;
}
