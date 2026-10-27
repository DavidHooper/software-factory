/**
 * Reads every page of a GitHub list endpoint by its `repos/{owner}/{repo}`
 * path. `gh api --paginate` follows GitHub's `Link` header instead, which
 * points later pages at `repositories/<id>/...`, a path the cloud proxy
 * refuses (#123).
 */

/** GitHub's largest page size: a page shorter than this is the last. */
const PER_PAGE = 100;

/** `path` asking for page `page` of `PER_PAGE` items, keeping its other parameters. */
function pagePath(path: string, page: number): string {
  const [base, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('per_page', String(PER_PAGE));
  params.set('page', String(page));
  return `${base ?? ''}?${params.toString()}`;
}

/**
 * Every item of the list at `path`, asking `get` for page 1, 2, … until a page
 * has fewer than `PER_PAGE` items. `itemsOf` picks the items out of a page
 * that wraps them, such as check runs' `{ check_runs: [...] }`.
 */
export function readPages<T>(path: string, get: (path: string) => T[]): T[];
export function readPages<T, P>(
  path: string,
  get: (path: string) => P,
  itemsOf: (page: P) => T[],
): T[];
export function readPages<T, P>(
  path: string,
  get: (path: string) => P,
  itemsOf: (page: P) => T[] = (page) => page as T[],
): T[] {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const pageItems = itemsOf(get(pagePath(path, page)));
    items.push(...pageItems);
    if (pageItems.length < PER_PAGE) {
      return items;
    }
  }
}
