import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { JwtExpiredError } from 'aws-jwt-verify/error';
import { clearCookie, setCookie } from './cookies.ts';
import { parseDocumentS3Key } from './documents.ts';
import { HttpError } from './http.ts';
import { DEMO_TTL_DAYS, demoExpiresAt, getCaller, getCookie, getUser, type VerifyIdToken } from './session.ts';

const DEMO = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const SUB = '9f8e7d6c-5b4a-4321-8fed-cba987654321';

const event = (headers: Record<string, string> = {}, cookies?: string[]) =>
  ({ headers, cookies }) as unknown as APIGatewayProxyEventV2;

const valid: VerifyIdToken = async (token) => {
  if (token !== 'good-token') throw new Error('bad signature');
  return { sub: SUB, email: 'ada@example.com', name: 'Ada Obi' };
};
const expired: VerifyIdToken = async () => {
  throw new JwtExpiredError('Token expired', 0);
};

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof HttpError && err.statusCode === status && err.code === code);
}

describe('getCaller', () => {
  it('maps the demo header into the demo- namespace, so it can never name a real workspace', async () => {
    assert.deepEqual(await getCaller(event({ 'x-workspace-id': DEMO.toUpperCase() }), valid), { kind: 'demo', workspaceId: `demo-${DEMO}` });
    const asSub = await getCaller(event({ 'x-workspace-id': SUB }), valid);
    assert.equal(asSub.workspaceId, `demo-${SUB}`); // a user's sub in the header still lands in the demo namespace
  });

  it('rejects a malformed demo header', async () => {
    await rejects(getCaller(event({ 'x-workspace-id': 'not-a-uuid' }), valid), 400);
  });

  it('uses the session cookie when there is no demo header: the workspace is the user sub', async () => {
    assert.deepEqual(await getCaller(event({}, ['other=1', 'lapse_id=good-token']), valid), {
      kind: 'user',
      workspaceId: SUB,
      userId: SUB,
      email: 'ada@example.com',
      name: 'Ada Obi',
    });
  });

  it('401s with a code the browser acts on', async () => {
    await rejects(getCaller(event(), valid), 401, 'unauthenticated');
    await rejects(getCaller(event({}, ['lapse_id=forged']), valid), 401, 'unauthenticated');
    await rejects(getCaller(event({}, ['lapse_id=old']), expired), 401, 'session_expired');
  });

  it('getUser ignores the demo header', async () => {
    await rejects(getUser(event({ 'x-workspace-id': DEMO }), valid), 401, 'unauthenticated');
    assert.equal((await getUser(event({ 'x-workspace-id': DEMO }, ['lapse_id=good-token']), valid)).workspaceId, SUB);
  });
});

describe('demo workspaces', () => {
  it('expire after the demo TTL; real workspaces never do', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    assert.equal(demoExpiresAt(`demo-${DEMO}`, now), now.getTime() / 1000 + DEMO_TTL_DAYS * 86_400);
    assert.equal(demoExpiresAt(SUB, now), undefined);
  });

  it('S3 keys parse for both demo and user workspaces', () => {
    assert.equal(parseDocumentS3Key(`ws/demo-${DEMO}/${SUB}/permit.pdf`)?.workspaceId, `demo-${DEMO}`);
    assert.equal(parseDocumentS3Key(`ws/${SUB}/${DEMO}/permit.pdf`)?.workspaceId, SUB);
    assert.equal(parseDocumentS3Key(`ws/evil-${DEMO}/${SUB}/x.pdf`), null);
  });
});

describe('cookies', () => {
  it('session cookies are HttpOnly, Secure and SameSite=Lax', () => {
    assert.equal(
      setCookie('lapse_id', 'a.b c', { path: '/api', maxAgeSeconds: 3600 }),
      'lapse_id=a.b%20c; Path=/api; Max-Age=3600; HttpOnly; Secure; SameSite=Lax',
    );
    assert.match(clearCookie('lapse_rt', '/api/auth'), /^lapse_rt=; Path=\/api\/auth; Max-Age=0;/);
  });

  it('reads cookies from the payload v2 cookies array', () => {
    assert.equal(getCookie({ cookies: ['a=1', 'lapse_id=x%20y'] }, 'lapse_id'), 'x y');
    assert.equal(getCookie({ cookies: undefined }, 'lapse_id'), undefined);
  });
});
