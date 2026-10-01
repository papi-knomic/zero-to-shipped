output "schedule_group_name" {
  value = aws_scheduler_schedule_group.this.name
}

output "scheduler_role_arn" {
  value = aws_iam_role.scheduler.arn
}

output "reminder_function_arn" {
  value = module.reminder.function_arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}
