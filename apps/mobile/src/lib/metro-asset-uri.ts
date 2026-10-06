/** Expo's dev asset resolver appends the filename to an unstable_path query,
 * leaving nested paths double-encoded. Metro then treats percent escapes as
 * literal filename characters and returns 404. Use its ordinary /assets route.
 * Embedded production assets and private photo URLs must remain untouched. */
export function normalizeMetroAssetUri(uri: string): string {
  if (!/^https?:\/\//.test(uri)) return uri;
  try {
    const url = new URL(uri);
    if (url.pathname !== '/assets/' || !url.searchParams.has('unstable_path')) return uri;
    const [encodedPath, secondaryQuery] = url.searchParams.get('unstable_path')!.split('?');
    const path = decodeURIComponent(encodedPath).replace(/^\.\//, '');
    // Never resolve an absolute path or escape the Metro project asset root.
    if (path.startsWith('/') || path.split('/').includes('..')) return uri;
    url.pathname = '/assets/' + path.split('/').map(encodeURIComponent).join('/');
    url.searchParams.delete('unstable_path');
    if (secondaryQuery) new URLSearchParams(secondaryQuery).forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  } catch {
    return uri;
  }
}
