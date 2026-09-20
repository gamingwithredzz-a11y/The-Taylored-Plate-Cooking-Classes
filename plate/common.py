import json
from datetime import datetime, timezone
from uuid import UUID

class Error(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status

def uid(value):
    try:
        result = str(UUID(str(value)))
        if UUID(result).int == 0:
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        raise Error('A valid nonzero avatar/request UUID is required.')

def clean(value, limit=100):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise Error('Invalid or oversized text field.')
    return value.strip()

def number(value, lo, hi):
    try:
        if isinstance(value, bool) or str(int(value)) != str(value):
            raise ValueError()
        result = int(value)
        if not lo <= result <= hi:
            raise ValueError()
        return result
    except (ValueError, TypeError):
        raise Error(f'Expected a whole number from {lo} to {hi}.')

def now():
    return datetime.now(timezone.utc).isoformat()

def audit(con, admin, action, payload):
    con.execute('INSERT INTO audit(at,admin,action,payload) VALUES(?,?,?,?)', (now(), admin, action, json.dumps(payload)))

def cohort_exists(con, cohort):
    if not con.execute('SELECT 1 FROM cohorts WHERE id=?', (cohort,)).fetchone():
        raise Error('Cohort not found.', 404)
