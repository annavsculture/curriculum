// api/proxy.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  if (!target || !target.startsWith('https://curriculum.nsw.edu.au')) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CurriculumExplorer/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/html',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600',
      },
    });
  } catch (e) {
    return new Response(`Proxy error: ${e.message}`, { status: 502 });
  }
}
