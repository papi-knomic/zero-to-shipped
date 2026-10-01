import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { tracer } from './observability.ts';

export const ddb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})), {
  marshallOptions: { removeUndefinedValues: true },
});

// WHEN_REQUIRED stops the SDK signing a CRC32 checksum into presigned PUT URLs,
// which browsers can't reproduce, so their uploads would fail.
export const s3 = tracer.captureAWSv3Client(new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' }));

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const scheduler = tracer.captureAWSv3Client(new SchedulerClient({}));
export const ses = tracer.captureAWSv3Client(new SESv2Client({}));
