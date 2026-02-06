import sqlite3
# A clear SQL injection vulnerability
def get_user(name):
    conn = sqlite3.connect('users.db')
    return conn.execute(f"SELECT * FROM users WHERE name = '{name}'")