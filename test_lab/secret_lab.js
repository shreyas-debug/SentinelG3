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
const API_KEY = process.env.API_KEY;

// ── Vulnerability 2: Hardcoded database credentials ─────────
const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// ── Vulnerability 3: JWT secret in source code ──────────────
const JWT_SECRET = process.env.JWT_SECRET;

function signToken(userId) {
  const jwt = require("jsonwebtoken");
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "24h" });
}

// ── Vulnerability 4: AWS credentials exposed ────────────────
// Managed via IAM Roles or Environment Variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
// The AWS SDK automatically loads these from the environment or instance metadata.

async function uploadToS3(file) {
  const AWS = require("aws-sdk");
  const s3 = new AWS.S3({
    region: process.env.AWS_REGION || "us-east-1",
  });
  return s3.upload({ Bucket: process.env.AWS_S3_BUCKET, Key: file.name, Body: file.data }).promise();
}

// ── Vulnerability 5: Sending secrets in HTTP headers ────────
app.get("/api/data", async (req, res) => {
  try {
    const response = await axios.get(process.env.EXTERNAL_SERVICE_URL, {
      headers: {
        Authorization: "Bearer " + API_KEY,
        "X-Custom-Token": process.env.CUSTOM_TOKEN,
      },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on :${PORT}`));