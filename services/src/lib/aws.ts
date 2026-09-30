import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
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
