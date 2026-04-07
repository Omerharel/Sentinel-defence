/**
 * In static hosts (S3/CloudFront), local `/api/*` routes do not exist.
 * Use NEXT_PUBLIC_API_BASE to point at a live API origin (e.g. Vercel deployment).
 */
export function getApiUrl(pathAndQuery: string): string {
  const p = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const base = process.env.NEXT_PUBLIC_API_BASE?.trim().replace(/\/$/, '') ?? '';
  return base ? `${base}${p}` : p;
}
