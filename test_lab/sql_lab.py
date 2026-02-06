"""
Vulnerability Lab — SQL Injection

This module deliberately contains SQL injection vulnerabilities
that a competent security auditor must catch. The Fixer agent
should rewrite every query to use parameterized statements.
"""

import sqlite3


# ── Vulnerability 1: Classic f-string injection ──────────────
def get_user_by_name(username: str) -> dict:
    """Look up a user by name. VULNERABLE: unsanitised f-string."""
    conn = sqlite3.connect("app.db")
    cursor = conn.execute(
        f"SELECT id, username, email FROM users WHERE username = '{username}'"
    )
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"id": row[0], "username": row[1], "email": row[2]}
    return {}


# ── Vulnerability 2: String concatenation injection ──────────
def search_products(query: str, category: str) -> list[dict]:
    """Search products. VULNERABLE: string concatenation in query."""
    conn = sqlite3.connect("shop.db")
    sql = "SELECT id, name, price FROM products WHERE name LIKE '%" + query + "%'"
    if category:
        sql += " AND category = '" + category + "'"
    rows = conn.execute(sql).fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "price": r[2]} for r in rows]


# ── Vulnerability 3: format() injection in DELETE ─────────────
def delete_user(user_id: str) -> bool:
    """Delete a user. VULNERABLE: .format() on a DELETE statement."""
    conn = sqlite3.connect("app.db")
    try:
        conn.execute(
            "DELETE FROM users WHERE id = {}".format(user_id)
        )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()
