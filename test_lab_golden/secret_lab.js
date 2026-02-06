/**
 * Vulnerability Lab — Hardcoded Secrets
 *
 * This module deliberately contains hardcoded API keys, passwords,
 * and tokens. The Auditor agent must flag every single one, and the
 * Fixer should replace them with environment variable lookups.
 */

const express = require("express");
const axios = require("axios");
const app = express();

// ── Vulnerability 1: Hardcoded API key ──────────────────────
const API_KEY = "sk-proj-abc123def456ghi789jkl012mno345pqrstu678";

// ── Vulnerability 2: Hardcoded database credentials ─────────
const DB_CONFIG = {
  host: "production-db.internal.company.com",
  port: 5432,
  user: "admin",
  password: "SuperSecret_Passw0rd!2025",
  database: "customers",
};

// ── Vulnerability 3: JWT secret in source code ──────────────
const JWT_SECRET = "my-ultra-secret-jwt-signing-key-do-not-share";

function signToken(userId) {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "24h" });
}

// ── Vulnerability 4: AWS credentials exposed ────────────────
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

async function uploadToS3(file) {
  // Uses hardcoded credentials instead of IAM roles or env vars
  const AWS = require("aws-sdk");
  const s3 = new AWS.S3({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    region: "us-east-1",
  });
  return s3.upload({ Bucket: "my-bucket", Key: file.name, Body: file.data }).promise();
}

// ── Vulnerability 5: Sending secrets in HTTP headers ────────
app.get("/api/data", async (req, res) => {
  try {
    const response = await axios.get("https://api.external-service.com/v1/data", {
      headers: {
        Authorization: "Bearer " + API_KEY,
        "X-Custom-Token": "hardcoded-token-value-12345",
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log("Server running on :3001"));
