output "app_name" {
  description = "The deployed Fly application name."
  value       = fly_app.beastforge.name
}

output "app_url" {
  description = "Public URL once deployed."
  value       = "https://${fly_app.beastforge.name}.fly.dev"
}

output "volume_id" {
  description = "Volume holding the SQLite database. Snapshot this before any change that could replace it."
  value       = fly_volume.data.id
}

output "health_check_url" {
  description = "Readiness endpoint the platform polls."
  value       = "https://${fly_app.beastforge.name}.fly.dev/ready"
}
