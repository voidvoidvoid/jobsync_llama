import { resolveMcpToken } from "@/lib/mcp/auth";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";

// Server-only. The extension calls JobSync with an access token from
// Settings (the same tokens as MCP access), never with the browser session.

// Background scripts with host permission are not bound by CORS, but a
// content script or a stricter browser may send a preflight. Only extension
// origins are answered; the bearer token is what grants access.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!/^(?:moz|chrome)-extension:\/\//.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function authenticate(
  req: Request,
  { rateLimited = false } = {},
): Promise<{ userId: string } | Response> {
  const auth = await resolveMcpToken(req);
  if (!auth.ok) return json(req, { error: auth.error }, auth.status);
  if (rateLimited) {
    const rate = checkMcpRateLimit(auth.userId);
    if (!rate.allowed) {
      return json(
        req,
        { error: `Too many requests. Try again in ${Math.ceil(rate.resetIn / 1000)}s.` },
        429,
      );
    }
  }
  return { userId: auth.userId };
}

export const corsFor = corsHeaders;
