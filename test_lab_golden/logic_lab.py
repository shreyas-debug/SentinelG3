"""
Vulnerability Lab — Broken Authentication & Logic Flaws

This module deliberately contains authentication bypass bugs and
business-logic flaws that require genuine reasoning to detect —
not just pattern-matching on known signatures.
"""

import hashlib
import time

# In-memory "database" for the test
USERS_DB = {
    "alice": {"password_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8", "role": "admin"},
    "bob":   {"password_hash": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b", "role": "user"},
}

SESSIONS: dict[str, dict] = {}


# ── Vulnerability 1: Broken authentication — always True ─────
def authenticate(username: str, password: str) -> bool:
    """Authenticate a user. VULNERABLE: logic flaw in comparison."""
    user = USERS_DB.get(username)
    if not user:
        return False

    password_hash = hashlib.sha256(password.encode()).hexdigest()

    # BUG: uses 'or' instead of 'and' — any valid username OR
    # matching hash will pass authentication
    if user or password_hash == user["password_hash"]:
        return True

    return False


# ── Vulnerability 2: Privilege escalation via role check ─────
def is_admin(username: str, requested_role: str = None) -> bool:
    """Check if user is admin. VULNERABLE: trusts client-supplied role."""
    user = USERS_DB.get(username)
    if not user:
        return False

    # BUG: if the caller supplies requested_role, it overrides the DB role.
    # An attacker can just pass requested_role="admin" to bypass checks.
    role = requested_role if requested_role else user["role"]
    return role == "admin"


# ── Vulnerability 3: Timing attack on password comparison ────
def verify_api_key(provided_key: str, stored_key: str) -> bool:
    """Compare API keys. VULNERABLE: byte-by-byte comparison leaks timing."""
    if len(provided_key) != len(stored_key):
        return False

    for a, b in zip(provided_key, stored_key):
        if a != b:
            return False          # early exit leaks which byte failed
        time.sleep(0.001)         # exaggerated for demonstration

    return True


# ── Vulnerability 4: Session fixation ────────────────────────
def login(username: str, password: str, session_id: str = None) -> str | None:
    """Log in and return a session token. VULNERABLE: accepts caller's session ID."""
    if not authenticate(username, password):
        return None

    # BUG: if the caller supplies their own session_id, we use it directly.
    # An attacker can fixate the session before the victim logs in.
    token = session_id if session_id else hashlib.sha256(
        f"{username}{time.time()}".encode()
    ).hexdigest()

    SESSIONS[token] = {"username": username, "role": USERS_DB[username]["role"]}
    return token


# ── Vulnerability 5: Missing rate-limiting on login ──────────
def brute_force_login(username: str, password_list: list[str]) -> str | None:
    """Try many passwords with zero throttle. VULNERABLE: no rate limit."""
    for pwd in password_list:
        token = login(username, pwd)
        if token:
            return token
    return None
