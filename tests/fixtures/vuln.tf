# tests/fixtures/vuln.tf
# Deliberately misconfigured Terraform file.
# Contains multiple high-severity IaC security issues.
# Used by tests/test_multilang.py to verify Auditor detects Terraform vulnerabilities.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# VULNERABILITY: S3 bucket with public-read ACL — exposes all objects to the internet
resource "aws_s3_bucket" "sensitive_data" {
  bucket = "my-company-sensitive-data"
  acl    = "public-read"  # CRITICAL: Every object is world-readable

  # Missing: versioning, logging, server-side encryption
}

# VULNERABILITY: S3 bucket policy allows any principal (*) to read all objects
resource "aws_s3_bucket_policy" "open_policy" {
  bucket = aws_s3_bucket.sensitive_data.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"          # HIGH: Any entity on the internet can access
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.sensitive_data.arn}/*"
      }
    ]
  })
}

# VULNERABILITY: Security group open to the world on all ports
resource "aws_security_group" "wide_open" {
  name = "wide-open-sg"

  ingress {
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # CRITICAL: World-accessible on all TCP ports
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# VULNERABILITY: Hardcoded database password in plaintext
resource "aws_db_instance" "prod_db" {
  identifier        = "prod-database"
  engine            = "mysql"
  instance_class    = "db.t3.micro"
  username          = "admin"
  password          = "SuperSecret123!"  # HIGH: Hardcoded secret in version control
  publicly_accessible = true             # HIGH: Database exposed to internet
  skip_final_snapshot = true
}
