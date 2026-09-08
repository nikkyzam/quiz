/* Infrastructure as Code for BeastForge (spec 11.7).

   fly.toml and render.yaml describe how to build and run the container. They
   do not describe the things that must exist BEFORE a deploy and must outlive
   every deploy after it: the app itself, the volume the database lives on,
   and the secrets. Those were previously created by hand, from instructions
   in DEPLOY.md, which means the real infrastructure was whatever someone
   typed once and nobody could reproduce.

   The volume is the part that makes this matter. This app keeps its data in
   SQLite on a mounted disk, so the volume IS the product: lose it and every
   learner's progress goes with it. It is declared here with an explicit
   lifecycle guard, so a change that would destroy and recreate it has to be
   argued with rather than applied by accident.

   Apply with credentials supplied at run time, never committed:
     export FLY_API_TOKEN=...          # fly tokens create deploy
     terraform -chdir=infra apply -var admin_emails=you@example.com
*/

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.0.23"
    }
  }
}

provider "fly" {
  # The token is read from FLY_API_TOKEN in the environment. Deliberately not
  # declared as a variable: a token in a .tfvars file is a token in someone's
  # shell history and, sooner or later, in the repository.
}

resource "fly_app" "beastforge" {
  name = var.app_name
  org  = var.fly_org
}

/* The database volume.

   `prevent_destroy` is the whole point of declaring this here. Terraform
   replaces a volume when an immutable attribute changes — region and size
   among them — and a replaced volume is an empty one. Without this guard a
   one-word edit to var.region would silently plan the deletion of every
   learner's progress and apply it without further comment. With it, that
   plan fails and a human has to decide, snapshot, and migrate deliberately. */
resource "fly_volume" "data" {
  app        = fly_app.beastforge.name
  name       = var.volume_name
  region     = var.region
  size       = var.volume_size_gb
  depends_on = [fly_app.beastforge]

  lifecycle {
    prevent_destroy = true
  }
}

/* Secrets are set here but never valued here: each is taken from a variable
   marked sensitive, supplied at apply time from the operator's environment or
   CI's secret store. Nothing secret is committed. */
resource "fly_machine" "app" {
  count = var.machine_count

  app    = fly_app.beastforge.name
  region = var.region
  name   = "${var.app_name}-${count.index}"
  image  = var.image

  env = {
    NODE_ENV = "production"
    PORT     = "8080"
    DB_FILE  = "/data/mathquest.db"

    # Retention enforcement (spec 10.3). The sweep is on by default in the
    # application; stated explicitly here so the operating period is visible
    # in the infrastructure rather than only in a default buried in code.
    RETENTION_SWEEP_HOURS = tostring(var.retention_sweep_hours)

    # Scheduled backups are OFF unless an interval is set, so the interval
    # belongs in infrastructure: a host with a volume and no backup schedule
    # is one disk failure from total loss.
    BACKUP_INTERVAL_HOURS = tostring(var.backup_interval_hours)
    BACKUP_KEEP           = tostring(var.backup_keep)
    BACKUP_DIR            = "/data/backups"

    ADMIN_EMAILS = var.admin_emails
  }

  mounts = [{
    volume = fly_volume.data.id
    path   = "/data"
  }]

  services = [{
    ports = [
      { port = 443, handlers = ["tls", "http"] },
      { port = 80, handlers = ["http"] }
    ]
    protocol      = "tcp"
    internal_port = 8080
  }]

  depends_on = [fly_volume.data]
}
