import sqlite3
import os
import logging

def get_user(name):
    db_path = os.environ.get('DATABASE_PATH', '/var/lib/myapp/users.db')
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        return conn.execute("SELECT id, name FROM users WHERE name = ? LIMIT 1000", (name,)).fetchall()
    except (sqlite3.Error, Exception) as e:
        logging.error("Database connection or query failed: %s", e)
        return []
    finally:
        if conn:
            conn.close()