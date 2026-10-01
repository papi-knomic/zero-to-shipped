import { GetAccountCommand, GetEmailIdentityCommand, NotFoundException } from '@aws-sdk/client-sesv2';
import { ses } from './aws.ts';

export type RecipientStatus = 'deliverable' | 'pending' | 'unverified';

async function identityVerified(identity: string): Promise<'SUCCESS' | 'PENDING' | 'NONE'> {
  try {
    const { VerificationStatus } = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
    if (VerificationStatus === 'SUCCESS') return 'SUCCESS';
    return VerificationStatus === 'PENDING' ? 'PENDING' : 'NONE';
  } catch (err) {
    if (err instanceof NotFoundException) return 'NONE';
    throw err;
  }
}

/**
 * Can SES deliver to this address? With production access, any address can receive.
 * In the sandbox, only verified addresses (or addresses on a verified domain) can.
 */
export async function recipientStatus(email: string): Promise<{ status: RecipientStatus; sandbox: boolean }> {
  const { ProductionAccessEnabled } = await ses.send(new GetAccountCommand({}));
  if (ProductionAccessEnabled) return { status: 'deliverable', sandbox: false };

  const domain = email.split('@')[1]!;
  const [address, domainStatus] = await Promise.all([identityVerified(email), identityVerified(domain)]);
  if (address === 'SUCCESS' || domainStatus === 'SUCCESS') return { status: 'deliverable', sandbox: true };
  return { status: address === 'PENDING' ? 'pending' : 'unverified', sandbox: true };
}
