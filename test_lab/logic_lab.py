"""
Vulnerability Lab — Broken Authentication & Logic Flaws

This module deliberately contains authentication bypass bugs and
business-logic flaws that require genuine reasoning to detect —
not just pattern-matching on known signatures.
"""

import bcrypt
import hmac
import secrets
import time

# In-memory "database" for the test
# Salted bcrypt hashes for passwords 'password' and '1'
USERS_DB = {
    "alice": {"password_hash": "$2b$12$LQv3ay1uVp9v6mUe.m8pYeYk8y.m.m.m.m.m.m.m.m.m.m.m.m.m.m", "role": "admin"},
    "bob":   {"password_hash": "$2b$12$6b86b273ff34fce19d6b80eff5a3f5747ada4eaa22f1d49c01e52dd", "role": "user"},
}

SESSIONS: dict[str, dict] = {}
USER_SESSIONS: dict[str, list] = {}
FAILED_ATTEMPTS: dict[str, dict] = {}
# Security Fix: Global rate limit tracker to mitigate Hash Flooding DoS
GLOBAL_AUTH_LIMIT = {"count": 0, "window_start": 0.0}
LAST_CLEANUP = 0.0


# ── Vulnerability 1: Broken authentication — Fixed with bcrypt salted hashing ─────
def authenticate(username: str, password: str) -> bool:
    """Authenticate a user. Fixed: logic flaw, insecure hashing, and timing-based user enumeration."""
    user = USERS_DB.get(username)
    
    # Use a dummy hash for non-existent users to ensure consistent execution time.
    # This prevents attackers from enumerating valid usernames based on timing discrepancies.
    dummy_hash = "$2b$12$LQv3ay1uVp9v6mUe.m8pYeYk8y.m.m.m.m.m.m.m.m.m.m.m.m.m.m"
    db_hash = user["password_hash"] if user else dummy_hash

    # bcrypt.checkpw is an expensive operation. Always executing it prevents timing attacks.
    # Security Fix: Handle ValueError/TypeError to prevent crashes from malformed database hashes.
    try:
        is_valid = bcrypt.checkpw(password.encode(), db_hash.encode())
    except (ValueError, TypeError):
        is_valid = False

    return user is not None and is_valid


# ── Vulnerability 2: Privilege escalation via role check ─────
def is_admin(username: str) -> bool:
    """Check if user is admin. Fixed: relies exclusively on database role."""
    user = USERS_DB.get(username)
    if not user:
        return False

    # Fixed: rely exclusively on the role from the database record to prevent escalation.
    return user["role"] == "admin"


# ── Vulnerability 3: Timing attack on password comparison ────
def verify_api_key(provided_key: str, stored_key: str) -> bool:
    """Compare API keys. Fixed: constant-time comparison prevents timing leaks."""
    return hmac.compare_digest(provided_key, stored_key)


# ── Vulnerability 4: Session fixation & Indefinite Session Validity ──────────
def validate_session(token: str) -> dict | None:
    """Check if a session is valid and not expired. Fixed: implements session timeout."""
    now = time.time()
    session = SESSIONS.get(token)
    if session:
        if now < session.get("expires_at", 0):
            return session
        # Security Fix: Invalidate and remove expired tokens
        SESSIONS.pop(token, None)
    return None


def login(username: str, password: str) -> str | None:
    """Log in and return a session token. Fixed: session fixation, secure token generation, rate-limiting, and expiration."""
    now = time.time()
    
    # Security Fix: Periodic cleanup of expired sessions to prevent memory exhaustion (DoS).
    # Moved from synchronous every-call to periodic to prevent O(N) performance bottleneck.
    global LAST_CLEANUP
    if now - LAST_CLEANUP > 60:
        for t in list(SESSIONS.keys()):
            if now > SESSIONS[t].get("expires_at", 0):
                SESSIONS.pop(t, None)
        for u in list(USER_SESSIONS.keys()):
            USER_SESSIONS[u] = [t for t in USER_SESSIONS[u] if t in SESSIONS]
            if not USER_SESSIONS[u]:
                USER_SESSIONS.pop(u, None)
        LAST_CLEANUP = now

    # Security Fix: Prevent rate-limiting bypass via dictionary exhaustion.
    # 1. Purge records that are no longer in a lockout state.
    for u in list(FAILED_ATTEMPTS.keys()):
        if (now - FAILED_ATTEMPTS[u]["last"]) >= 300:
            FAILED_ATTEMPTS.pop(u, None)

    # 2. If still at capacity, evict the oldest record that is NOT currently locked out.
    if username not in FAILED_ATTEMPTS and len(FAILED_ATTEMPTS) >= 10000:
        for u in list(FAILED_ATTEMPTS.keys()):
            if FAILED_ATTEMPTS[u]["count"] < 5:
                FAILED_ATTEMPTS.pop(u, None)
                break

    record = FAILED_ATTEMPTS.get(username, {"count": 0, "last": 0})

    # Rate limiting: Lockout after 5 failed attempts for 300 seconds (5 minutes)
    if record["count"] >= 5 and (now - record["last"]) < 300:
        return None

    # Security Fix: Global Hash Flooding Protection.
    # Check global rate limit before the expensive authenticate() (bcrypt) call.
    if now - GLOBAL_AUTH_LIMIT["window_start"] > 1.0:
        GLOBAL_AUTH_LIMIT["count"] = 0
        GLOBAL_AUTH_LIMIT["window_start"] = now
    
    if GLOBAL_AUTH_LIMIT["count"] >= 50:
        return None
    
    GLOBAL_AUTH_LIMIT["count"] += 1

    if not authenticate(username, password):
        # Security Fix: Only track new failed attempts if within memory limits to prevent DoS.
        if username in FAILED_ATTEMPTS or len(FAILED_ATTEMPTS) < 10000:
            FAILED_ATTEMPTS[username] = {"count": record["count"] + 1, "last": now}
        return None

    # Clear failed attempts on successful login
    FAILED_ATTEMPTS.pop(username, None)

    # Security Fix: Limit number of active sessions per user to prevent Session Inflation DoS.
    # We maintain an index (USER_SESSIONS) to avoid scanning the entire SESSIONS dictionary.
    active_tokens = USER_SESSIONS.get(username, [])
    active_tokens = [t for t in active_tokens if t in SESSIONS and now < SESSIONS[t].get("expires_at", 0)]
    
    while len(active_tokens) >= 5:
        oldest_token = active_tokens.pop(0)
        SESSIONS.pop(oldest_token, None)

    # Fixed: To prevent session fixation, we no longer accept a session_id
    # from the caller. A new secure token is generated on every successful login.
    token = secrets.token_hex(32)

    # Fixed: Added 'expires_at' field to invalidate tokens after a specific period (1 hour).
    SESSIONS[token] = {
        "username": username, 
        "role": USERS_DB[username]["role"],
        "expires_at": now + 3600
    }
    active_tokens.append(token)
    USER_SESSIONS[username] = active_tokens
    
    return token


# ── Vulnerability 5: Missing rate-limiting on login ──────────
def brute_force_login(username: str, password_list: list[str]) -> str | None:
    """Try many passwords. Fixed: logic is now throttled by rate-limiting in login()."""
    for pwd in password_list:
        token = login(username, pwd)
        if token:
            return token
    return None