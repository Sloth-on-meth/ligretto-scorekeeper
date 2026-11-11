// SQLite's datetime('now') gives "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
// Parsing that directly treats it as local time, which shifts every timestamp by the
// viewer's offset, so convert it to an explicit UTC ISO string first.

export function parseServerDate(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  return new Date(m ? `${m[1]}T${m[2]}Z` : value);
}

export function formatDate(value: string): string {
  const d = parseServerDate(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string): string {
  const d = parseServerDate(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
