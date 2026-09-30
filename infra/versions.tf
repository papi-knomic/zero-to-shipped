terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  backend "s3" {
    bucket       = "zts-tfstate-117227382789"
    key          = "infra/terraform.tfstate"
    region       = "us-east-1"
    profile      = "zts"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  profile             = "zts"
  region              = "us-east-1"
  allowed_account_ids = ["117227382789"]

  default_tags {
    tags = {
      project = "zero-to-shipped"
    }
  }
}
