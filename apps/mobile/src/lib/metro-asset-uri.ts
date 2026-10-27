/** Expo's dev asset resolver appends the filename to an unstable_path query,
 * leaving nested paths double-encoded. Metro then treats percent escapes as
 * literal filename characters and returns 404. Use its ordinary /assets route.
 * Embedded production assets and private photo URLs must remain untouched. */
export function normalizeMetroAssetUri(uri: string): string {
  if (!/^https?:\/\//.test(uri)) return uri;
  try {
    const url = new URL(uri);
    if (url.pathname !== '/assets/' || !url.searchParams.has('unstable_path')) return uri;
    // RN concatenates the filename without encoding it. An & in that filename
    // is part of the path, not another query parameter. Read it before parsing.
    const rawQuery = uri.slice(uri.indexOf('?') + 1);
    const marker = /(?:^|&)unstable_path=/.exec(rawQuery)!;
    const rawValue = rawQuery.slice(marker.index + marker[0].length);
    const nestedQuery = rawValue.indexOf('?');
    let encodedPath: string, secondaryQuery: string | undefined;
    if (nestedQuery >= 0) {
      encodedPath = decodeURIComponent(rawValue.slice(0, nestedQuery));
      secondaryQuery = rawValue.slice(nestedQuery + 1);
      // Remove phantom parameters created by unescaped ampersands in filenames.
      url.search = rawQuery.slice(0, marker.index);
    } else {
      [encodedPath, secondaryQuery] = url.searchParams.get('unstable_path')!.split('?');
      url.searchParams.delete('unstable_path');
    }
    const path = decodeURIComponent(encodedPath).replace(/^\.\//, '');
    // Never resolve an absolute path or escape the Metro project asset root.
    if (path.startsWith('/') || path.split('/').includes('..')) return uri;
    url.pathname = '/assets/' + path.split('/').map(encodeURIComponent).join('/');
    if (secondaryQuery) new URLSearchParams(secondaryQuery).forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  } catch {
    return uri;
  }
}
