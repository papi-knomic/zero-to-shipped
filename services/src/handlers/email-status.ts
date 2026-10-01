import { apiHandler, getWorkspaceId, HttpError, json } from '../lib/http.ts';
import { isEmail } from '../lib/reminders.ts';
import { recipientStatus } from '../lib/ses-identity.ts';

/** GET /api/email/status?email= → can reminders reach this address yet? */
export const handler = apiHandler(async (event) => {
  getWorkspaceId(event); // same header requirement as the rest of the API
  const email = event.queryStringParameters?.email?.trim().toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'email must be a valid email address');

  return json(200, { email, ...(await recipientStatus(email)) });
});
