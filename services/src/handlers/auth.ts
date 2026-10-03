import { createHmac } from 'node:crypto';
import {
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ExpiredCodeException,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  InvalidPasswordException,
  LimitExceededException,
  NotAuthorizedException,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  TooManyFailedAttemptsException,
  TooManyRequestsException,
  UserNotConfirmedException,
  UsernameExistsException,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ddb, requireEnv } from '../lib/aws.ts';
import { clearCookie, setCookie } from '../lib/cookies.ts';
import { workspacePk } from '../lib/documents.ts';
import { HttpError, apiHandler, json, parseJsonBody, type ApiResult } from '../lib/http.ts';
import { logger, tracer } from '../lib/observability.ts';
import { isEmail } from '../lib/reminders.ts';
import { ID_COOKIE, getCookie, getUser } from '../lib/session.ts';

// /api/auth/{action}: email + password sign-in against Cognito. Only this function talks to
// Cognito, with the app client's secret, so nobody can sign up or sign in around the API.

const TABLE_NAME = requireEnv('TABLE_NAME');
const CLIENT_ID = requireEnv('USER_POOL_CLIENT_ID');
const CLIENT_SECRET_PARAM = requireEnv('CLIENT_SECRET_PARAM');

const REFRESH_COOKIE = 'lapse_rt';
/** Cognito username (the sub): refreshing with a client secret needs it for the SECRET_HASH. */
const USER_COOKIE = 'lapse_uid';
const ID_MAX_AGE = 60 * 60; // matches the ID token's validity
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // matches the refresh token's validity

const cognito = tracer.captureAWSv3Client(new CognitoIdentityProviderClient({}));
const ssm = tracer.captureAWSv3Client(new SSMClient({}));

let clientSecret: Promise<string> | undefined;
function getClientSecret(): Promise<string> {
  clientSecret ??= ssm
    .send(new GetParameterCommand({ Name: CLIENT_SECRET_PARAM, WithDecryption: true }))
    .then((r) => r.Parameter?.Value ?? Promise.reject(new Error('client secret parameter is empty')))
    .catch((err) => {
      clientSecret = undefined; // don't cache a failure for the life of the container
      throw err;
    });
  return clientSecret;
}

async function secretHash(username: string): Promise<string> {
  return createHmac('sha256', await getClientSecret()).update(username + CLIENT_ID).digest('base64');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function body(event: APIGatewayProxyEventV2): Record<string, unknown> {
  return (parseJsonBody(event) ?? {}) as Record<string, unknown>;
}

function email(value: unknown): string {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (!isEmail(v)) throw new HttpError(400, 'Enter a valid email address');
  return v;
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 256) {
    throw new HttpError(400, 'Password must be at least 10 characters');
  }
  return value;
}

function fullName(value: unknown): string {
  const v = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (v.length < 1 || v.length > 100) throw new HttpError(400, 'Enter your name (up to 100 characters)');
  return v;
}

function code(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{6}$/.test(v)) throw new HttpError(400, 'Enter the 6-digit code from the email');
  return v;
}

/** Cognito errors → messages a person can act on. Anything unexpected stays a 500. */
function cognitoError(err: unknown): never {
  if (err instanceof UsernameExistsException) throw new HttpError(409, 'An account with this email already exists. Sign in instead.', 'exists');
  if (err instanceof InvalidPasswordException) throw new HttpError(400, err.message.replace(/^Password did not conform with policy: /, ''));
  if (err instanceof CodeMismatchException) throw new HttpError(400, 'That code is not right. Check the email and try again.');
  if (err instanceof ExpiredCodeException) throw new HttpError(400, 'That code has expired. Request a new one.', 'code_expired');
  if (err instanceof UserNotConfirmedException) throw new HttpError(403, 'Confirm your email address first.', 'unconfirmed');
  if (err instanceof NotAuthorizedException) throw new HttpError(401, 'Incorrect email or password', 'unauthenticated');
  if (err instanceof LimitExceededException || err instanceof TooManyRequestsException || err instanceof TooManyFailedAttemptsException) {
    throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Claims of an ID token Cognito just returned to us over TLS (verified on every later request). */
function claims(idToken: string): { sub: string; email: string; name: string; username: string } {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  return {
    sub: String(payload.sub),
    email: String(payload.email ?? ''),
    name: String(payload.name ?? ''),
    username: String(payload['cognito:username'] ?? payload.sub),
  };
}

const publicUser = (u: { sub: string; email: string; name: string }) => ({ userId: u.sub, email: u.email, name: u.name });

function sessionCookies(tokens: AuthenticationResultType, username?: string): string[] {
  const cookies = [setCookie(ID_COOKIE, tokens.IdToken!, { path: '/api', maxAgeSeconds: ID_MAX_AGE })];
  // A refresh returns no new refresh token; keep the existing cookies in that case.
  if (tokens.RefreshToken && username) {
    cookies.push(setCookie(REFRESH_COOKIE, tokens.RefreshToken, { path: '/api/auth', maxAgeSeconds: REFRESH_MAX_AGE }));
    cookies.push(setCookie(USER_COOKIE, username, { path: '/api/auth', maxAgeSeconds: REFRESH_MAX_AGE }));
  }
  return cookies;
}

const signedOutCookies = () => [clearCookie(ID_COOKIE, '/api'), clearCookie(REFRESH_COOKIE, '/api/auth'), clearCookie(USER_COOKIE, '/api/auth')];

/** Every user gets a personal workspace keyed by their sub. Idempotent. */
async function ensureWorkspace(user: { sub: string; email: string; name: string }): Promise<void> {
  const { sub } = user;
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: workspacePk(sub),
          SK: 'META',
          workspaceId: sub,
          ownerId: sub,
          ownerEmail: user.email,
          ownerName: user.name,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    logger.info('workspace created', { workspaceId: sub });
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action = (event: APIGatewayProxyEventV2) => Promise<ApiResult>;

const actions: Record<string, { method: 'GET' | 'POST'; run: Action }> = {
  signup: {
    method: 'POST',
    run: async (event) => {
      const b = body(event);
      const username = email(b.email);
      const name = fullName(b.name);
      const res = await cognito
        .send(
          new SignUpCommand({
            ClientId: CLIENT_ID,
            SecretHash: await secretHash(username),
            Username: username,
            Password: password(b.password),
            UserAttributes: [
              { Name: 'email', Value: username },
              { Name: 'name', Value: name },
            ],
          }),
        )
        .catch(cognitoError);
      logger.info('sign-up started');
      return json(200, { next: res.UserConfirmed ? 'signin' : 'confirm', destination: res.CodeDeliveryDetails?.Destination });
    },
  },

  confirm: {
    method: 'POST',
    run: async (event) => {
      const b = body(event);
      const username = email(b.email);
      await cognito
        .send(new ConfirmSignUpCommand({ ClientId: CLIENT_ID, SecretHash: await secretHash(username), Username: username, ConfirmationCode: code(b.code) }))
        .catch(cognitoError);
      logger.info('sign-up confirmed');
      return json(200, { next: 'signin' });
    },
  },

  'resend-code': {
    method: 'POST',
    run: async (event) => {
      const username = email(body(event).email);
      await cognito
        .send(new ResendConfirmationCodeCommand({ ClientId: CLIENT_ID, SecretHash: await secretHash(username), Username: username }))
        .catch(cognitoError);
      return json(200, { ok: true });
    },
  },

  signin: {
    method: 'POST',
    run: async (event) => {
      const b = body(event);
      const username = email(b.email);
      const res = await cognito
        .send(
          new InitiateAuthCommand({
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: username, PASSWORD: typeof b.password === 'string' ? b.password : '', SECRET_HASH: await secretHash(username) },
          }),
        )
        .catch(cognitoError);
      if (!res.AuthenticationResult?.IdToken) {
        // No challenges are configured (no MFA, no forced password change), so this shouldn't happen.
        logger.error('unexpected auth challenge', { challenge: res.ChallengeName });
        throw new HttpError(500, 'Sign-in needs a step this app does not support yet');
      }
      const user = claims(res.AuthenticationResult.IdToken);
      await ensureWorkspace(user);
      logger.info('signed in', { userId: user.sub });
      return json(200, { user: publicUser(user) }, sessionCookies(res.AuthenticationResult, user.username));
    },
  },

  refresh: {
    method: 'POST',
    run: async (event) => {
      const refreshToken = getCookie(event, REFRESH_COOKIE);
      const username = getCookie(event, USER_COOKIE);
      if (!refreshToken || !username) throw new HttpError(401, 'Sign in to continue', 'unauthenticated');
      try {
        const res = await cognito.send(
          new InitiateAuthCommand({
            ClientId: CLIENT_ID,
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: await secretHash(username) },
          }),
        );
        const user = claims(res.AuthenticationResult!.IdToken!);
        return json(200, { user: publicUser(user) }, sessionCookies(res.AuthenticationResult!));
      } catch (err) {
        if (!(err instanceof NotAuthorizedException)) throw err;
        // Expired or revoked refresh token: clear everything so the browser starts clean.
        return json(401, { error: 'Session expired. Sign in again.', code: 'unauthenticated' }, signedOutCookies());
      }
    },
  },

  signout: {
    method: 'POST',
    run: async (event) => {
      const refreshToken = getCookie(event, REFRESH_COOKIE);
      if (refreshToken) {
        // Revokes the refresh token and the access tokens issued from it.
        await cognito
          .send(new RevokeTokenCommand({ ClientId: CLIENT_ID, ClientSecret: await getClientSecret(), Token: refreshToken }))
          .catch((err) => logger.warn('token revocation failed', { error: String(err) }));
      }
      return json(200, { ok: true }, signedOutCookies());
    },
  },

  'forgot-password': {
    method: 'POST',
    run: async (event) => {
      const username = email(body(event).email);
      // With user-existence errors prevented, this succeeds whether or not the account exists.
      await cognito
        .send(new ForgotPasswordCommand({ ClientId: CLIENT_ID, SecretHash: await secretHash(username), Username: username }))
        .catch(cognitoError);
      return json(200, { ok: true });
    },
  },

  'reset-password': {
    method: 'POST',
    run: async (event) => {
      const b = body(event);
      const username = email(b.email);
      await cognito
        .send(
          new ConfirmForgotPasswordCommand({
            ClientId: CLIENT_ID,
            SecretHash: await secretHash(username),
            Username: username,
            ConfirmationCode: code(b.code),
            Password: password(b.password),
          }),
        )
        .catch(cognitoError);
      logger.info('password reset');
      return json(200, { next: 'signin' });
    },
  },

  me: {
    method: 'GET',
    run: async (event) => {
      const user = await getUser(event);
      return json(200, { user: { userId: user.userId, email: user.email, name: user.name } });
    },
  },
};

export const handler = apiHandler(async (event) => {
  const action = actions[event.pathParameters?.action ?? ''];
  if (!action) throw new HttpError(404, 'Not found');
  if (event.requestContext.http.method !== action.method) throw new HttpError(405, `Use ${action.method}`);
  return action.run(event);
});
