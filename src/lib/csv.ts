/** Build a CSV string from rows of cells. Quotes any cell containing a comma,
 * quote, or newline (RFC 4180), and joins rows with CRLF for spreadsheet apps. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

/** Dollars string (no symbol) for CSV money cells, e.g. 1234 -> "12.34". */
export function csvDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
