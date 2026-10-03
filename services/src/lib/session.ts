import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { JwtExpiredError } from 'aws-jwt-verify/error';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { HttpError, isUuid } from './http.ts';

// Who is calling: a signed-in user (Cognito ID token in an HttpOnly cookie) or the no-login demo
// (a browser-generated UUID in the x-workspace-id header, always mapped into the demo- namespace,
// so it can never name a real user's workspace).

export const ID_COOKIE = 'lapse_id';
export const DEMO_PREFIX = 'demo-';
/** Demo documents, files and notifications are deleted this long after they're created. */
export const DEMO_TTL_DAYS = 7;

export type Caller =
  | { kind: 'user'; workspaceId: string; userId: string; email: string; name: string }
  | { kind: 'demo'; workspaceId: string };

export const isDemoWorkspace = (workspaceId: string) => workspaceId.startsWith(DEMO_PREFIX);

/** DynamoDB TTL (epoch seconds) for items in a demo workspace; undefined for real workspaces. */
export function demoExpiresAt(workspaceId: string, from: Date = new Date()): number | undefined {
  if (!isDemoWorkspace(workspaceId)) return undefined;
  return Math.floor(from.getTime() / 1000) + DEMO_TTL_DAYS * 86_400;
}

/** HTTP API (payload v2) puts cookies in event.cookies, not in the headers. */
export function getCookie(event: Pick<APIGatewayProxyEventV2, 'cookies'>, name: string): string | undefined {
  for (const cookie of event.cookies ?? []) {
    const eq = cookie.indexOf('=');
    if (eq > 0 && cookie.slice(0, eq).trim() === name) return decodeURIComponent(cookie.slice(eq + 1).trim());
  }
  return undefined;
}

export interface IdClaims {
  sub: string;
  email: string;
  name: string;
}

export type VerifyIdToken = (token: string) => Promise<IdClaims>;

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; tokenUse: 'id'; clientId: string }>> | undefined;

/** Verifies signature, expiry, issuer, audience and token use; caches the pool's JWKS per container. */
export const verifyIdToken: VerifyIdToken = async (token) => {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID ?? '',
    tokenUse: 'id',
    clientId: process.env.USER_POOL_CLIENT_ID ?? '',
  });
  const payload = await verifier.verify(token);
  return { sub: payload.sub, email: String(payload.email ?? ''), name: String(payload.name ?? '') };
};

/**
 * Resolves the caller. The demo header wins when present, so a signed-in user can still open the
 * demo; otherwise the session cookie is required. 401s carry a code the browser acts on.
 */
export async function getCaller(event: APIGatewayProxyEventV2, verify: VerifyIdToken = verifyIdToken): Promise<Caller> {
  const demoId = event.headers['x-workspace-id']?.toLowerCase();
  if (demoId !== undefined) {
    if (!isUuid(demoId)) throw new HttpError(400, 'Invalid x-workspace-id header');
    return { kind: 'demo', workspaceId: `${DEMO_PREFIX}${demoId}` };
  }
  return getUser(event, verify);
}

/** The signed-in user, from the session cookie only (the demo header is ignored). */
export async function getUser(
  event: APIGatewayProxyEventV2,
  verify: VerifyIdToken = verifyIdToken,
): Promise<Extract<Caller, { kind: 'user' }>> {
  const token = getCookie(event, ID_COOKIE);
  if (!token) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
  try {
    const { sub, email, name } = await verify(token);
    // A user's personal workspace is keyed by their Cognito sub: unique, immutable, and signed.
    return { kind: 'user', workspaceId: sub, userId: sub, email, name };
  } catch (err) {
    if (err instanceof JwtExpiredError) throw new HttpError(401, 'Session expired', 'session_expired');
    throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
  }
}
