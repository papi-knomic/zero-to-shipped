output "function_name" {
  value = module.extract.function_name
}

output "queue_name" {
  value = aws_sqs_queue.extract.name
}

output "dlq_name" {
  value = aws_sqs_queue.dlq.name
}
