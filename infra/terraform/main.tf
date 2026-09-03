# Infrastructure as code for BeastForge on Fly.io (spec 11.7).
#
#   terraform init
#   terraform apply -var admin_emails=you@example.com -var data_key=$(head -c 32 /dev/urandom | base64)
#
# Declares the application, its persistent volume for SQLite, and the secrets
# the server needs. The image itself is shipped by .github/workflows/deploy.yml
# (or `flyctl deploy`), so applying this does not by itself start serving
# traffic; it makes the place for the code to land, reproducibly.

terraform {
  required_version = ">= 1.5"
  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.1"
    }
  }
}

provider "fly" {
  # FLY_API_TOKEN is read from the environment.
}

variable "app_name" {
  description = "Fly application name; must match fly.toml"
  type        = string
  default     = "beastforge"
}

variable "region" {
  description = "Primary region; must match fly.toml"
  type        = string
  default     = "lhr"
}

variable "volume_size_gb" {
  description = "Size of the SQLite volume mounted at /data"
  type        = number
  default     = 1
}

variable "admin_emails" {
  description = "Comma-separated emails granted the admin role (ADMIN_EMAILS)"
  type        = string
  sensitive   = true
}

variable "data_key" {
  description = "32-byte base64 key for encryption at rest (DATA_KEY); keep in a KMS or secret store and rotate via DATA_KEY_PREVIOUS"
  type        = string
  sensitive   = true
}

resource "fly_app" "beastforge" {
  name = var.app_name
}

# The database lives here; the name must match [[mounts]] in fly.toml.
resource "fly_volume" "data" {
  app    = fly_app.beastforge.name
  name   = "mathquest_data"
  region = var.region
  size   = var.volume_size_gb
}

resource "fly_ip" "v4" {
  app  = fly_app.beastforge.name
  type = "v4"
}

resource "fly_ip" "v6" {
  app  = fly_app.beastforge.name
  type = "v6"
}

# Secrets are set through the CLI provider-side; this null_resource records
# the intent and applies them idempotently. `flyctl secrets set` is a no-op
# when the value is unchanged.
resource "null_resource" "secrets" {
  triggers = {
    admin_emails = sha256(var.admin_emails)
    data_key     = sha256(var.data_key)
  }
  provisioner "local-exec" {
    command = "flyctl secrets set --app ${fly_app.beastforge.name} ADMIN_EMAILS='${var.admin_emails}' DATA_KEY='${var.data_key}' BACKUP_ENCRYPT=1 BACKUP_INTERVAL_HOURS=6"
  }
  depends_on = [fly_app.beastforge]
}

output "app_url" {
  value = "https://${fly_app.beastforge.name}.fly.dev"
}

output "health_check" {
  value = "https://${fly_app.beastforge.name}.fly.dev/ready"
}
