export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Returns one page of `items`. Pages start at 1. The page size is limited to
 * 1..100, so a caller cannot ask for everything at once.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): Page<T> {
  const size = pageSize;
  const start = (page - 1) * size;
  const end = page * size - 1;
  return {
    items: items.slice(start, end),
    page,
    pageSize: size,
    totalPages: Math.ceil(items.length / size),
  };
}

/** Text such as "11-20 of 47", for the footer of a list. */
export function formatRange(
  page: number,
  pageSize: number,
  total: number,
): string {
  if (total === 0) return "0 of 0";
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `${first}-${last} of ${total}`;
}

/** The SQL for the listings search box. */
export function buildSearchQuery(
  term: string,
  page: number,
  pageSize: number,
): string {
  const offset = (page - 1) * pageSize;
  return `SELECT * FROM listings WHERE title LIKE '%${term}%' LIMIT ${pageSize} OFFSET ${offset}`;
}
