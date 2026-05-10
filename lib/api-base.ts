/**
 * Build API URLs that support both local Next.js API routes
 * and static-hosted frontends (S3/CloudFront) calling an external backend.
 */
const STATIC_HOSTED_FALLBACK_API_BASE =
  process.env.NEXT_PUBLIC_STATIC_FALLBACK_API_BASE?.trim().replace(/\/$/, '') ??
  'https://sentinel-defence-production.up.railway.app';

export function getApiUrl(pathAndQuery: string): string {
  const normalizedPath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const base = process.env.NEXT_PUBLIC_API_BASE?.trim().replace(/\/$/, '') ?? '';
  if (base) return `${base}${normalizedPath}`;

  if (typeof window !== 'undefined') return `${STATIC_HOSTED_FALLBACK_API_BASE}${normalizedPath}`;

  return normalizedPath;
}
