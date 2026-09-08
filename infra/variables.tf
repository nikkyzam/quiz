variable "app_name" {
  description = "Fly application name. Must be globally unique."
  type        = string
  default     = "beastforge"
}

variable "fly_org" {
  description = "Fly organisation slug that owns the app."
  type        = string
  default     = "personal"
}

variable "region" {
  description = "Primary Fly region. Changing this replaces the volume — see the prevent_destroy guard in main.tf."
  type        = string
  default     = "lhr"
}

variable "volume_name" {
  description = "Name of the persistent volume holding the SQLite database."
  type        = string
  default     = "mathquest_data"
}

variable "volume_size_gb" {
  description = "Volume size in GB. Growing it is safe; shrinking replaces it and destroys the data."
  type        = number
  default     = 1

  validation {
    condition     = var.volume_size_gb >= 1
    error_message = "The volume must be at least 1 GB."
  }
}

variable "image" {
  description = "Container image to run, e.g. registry.fly.io/beastforge:deployment-01H..."
  type        = string
}

variable "machine_count" {
  description = "Number of machines. Kept at 1 by default: the database is a single SQLite file on one volume, so a second machine would not share it."
  type        = number
  default     = 1

  validation {
    # A second machine mounting a different volume would serve a different,
    # silently diverging database. Scaling out needs a database change first,
    # so this refuses rather than letting a number make that decision.
    condition     = var.machine_count == 1
    error_message = "SQLite on a single volume cannot be served by more than one machine. Move to a networked database before raising this."
  }
}

variable "admin_emails" {
  description = "Comma-separated emails granted admin access. Supply at apply time; never commit."
  type        = string
  sensitive   = true
}

variable "retention_sweep_hours" {
  description = "How often the retention sweep runs (spec 10.3). 0 disables it, which means keeping data past its stated retention."
  type        = number
  default     = 24

  validation {
    condition     = var.retention_sweep_hours >= 0 && var.retention_sweep_hours <= 168
    error_message = "Retention sweep interval must be between 0 (disabled) and 168 hours."
  }
}

variable "backup_interval_hours" {
  description = "How often to snapshot the database. Must be greater than zero in production."
  type        = number
  default     = 6

  validation {
    condition     = var.backup_interval_hours > 0
    error_message = "A host holding the only copy of the database must take backups; set an interval above zero."
  }
}

variable "backup_keep" {
  description = "How many snapshots to retain on the volume."
  type        = number
  default     = 7
}
