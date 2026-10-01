import {
  ActionAfterCompletion,
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { requireEnv, scheduler } from './aws.ts';
import { atExpression } from './reminders.ts';

const SCHEDULE_GROUP = requireEnv('SCHEDULE_GROUP');
const REMINDER_FUNCTION_ARN = requireEnv('REMINDER_FUNCTION_ARN');
const SCHEDULER_ROLE_ARN = requireEnv('SCHEDULER_ROLE_ARN');

export interface ReminderPayload {
  workspaceId: string;
  docId: string;
  offsetDays: number | null;
  test: boolean;
}

/** One-time schedule that invokes the reminder Lambda once and then deletes itself. */
export async function createReminderSchedule(name: string, at: Date, payload: ReminderPayload): Promise<'created' | 'exists'> {
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: name,
        GroupName: SCHEDULE_GROUP,
        ScheduleExpression: atExpression(at),
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        ActionAfterCompletion: ActionAfterCompletion.DELETE,
        Target: {
          Arn: REMINDER_FUNCTION_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify(payload),
          RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
        },
      }),
    );
    return 'created';
  } catch (err) {
    if (err instanceof ConflictException) return 'exists';
    throw err;
  }
}

/** Deletes a schedule; one that already fired (and self-deleted) or never existed is fine. */
export async function deleteReminderSchedule(name: string): Promise<void> {
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: SCHEDULE_GROUP }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
}
