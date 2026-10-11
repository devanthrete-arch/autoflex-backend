/** A Maps share link is displayed, never fetched or treated as coordinates. */
export function isGoogleMapsUrl(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string' || value.length > 1024) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      return false;
    if (['maps.google.com', 'maps.google.co.in'].includes(url.hostname))
      return true;
    if (url.hostname === 'maps.app.goo.gl') return url.pathname.length > 1;
    if (
      [
        'goo.gl',
        'google.com',
        'www.google.com',
        'google.co.in',
        'www.google.co.in',
      ].includes(url.hostname)
    )
      return url.pathname === '/maps' || url.pathname.startsWith('/maps/');
    return false;
  } catch {
    return false;
  }
}
