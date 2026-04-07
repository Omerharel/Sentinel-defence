function isAllowedOrigin(origin: string): boolean {
  if (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') return true;
  if (origin === 'https://sentinel-defence.vercel.app') return true;
  if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return true;
  if (/^https?:\/\/[a-z0-9.-]+\.s3-website\.[a-z0-9-]+\.amazonaws\.com$/i.test(origin)) return true;
  return false;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && isAllowedOrigin(origin) ? origin : '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (allowOrigin !== '*') headers.Vary = 'Origin';
  return headers;
}

export function mergeCors(
  request: Request,
  headers: Record<string, string> | undefined,
): Record<string, string> {
  return { ...corsHeaders(request), ...(headers ?? {}) };
}
