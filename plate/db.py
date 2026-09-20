import sqlite3
from contextlib import contextmanager, closing

SCHEMA = '''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS cohorts(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weeks(cohort TEXT REFERENCES cohorts(id), week INTEGER CHECK(week BETWEEN 1 AND 4), title TEXT NOT NULL, PRIMARY KEY(cohort,week));
CREATE TABLE IF NOT EXISTS avatars(uuid TEXT PRIMARY KEY, legacy TEXT NOT NULL, display TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, cohort TEXT REFERENCES cohorts(id), station INTEGER NOT NULL CHECK(station BETWEEN 1 AND 6), type TEXT CHECK(type IN ('Individual','Couple')));
CREATE TABLE IF NOT EXISTS enrollments(cohort TEXT REFERENCES cohorts(id), avatar TEXT REFERENCES avatars(uuid), reservation TEXT REFERENCES reservations(id), partner TEXT REFERENCES avatars(uuid), status TEXT CHECK(status IN ('Active','Completed','Withdrawn')), enrolled TEXT NOT NULL, graduation_eligible INTEGER DEFAULT NULL, gift_received INTEGER NOT NULL DEFAULT 0, certificate_received INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(cohort,avatar));
CREATE TABLE IF NOT EXISTS terminals(id TEXT PRIMARY KEY, cohort TEXT REFERENCES cohorts(id), week INTEGER CHECK(week BETWEEN 1 AND 4), opened INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS attendance(cohort TEXT, avatar TEXT, week INTEGER CHECK(week BETWEEN 1 AND 4), status TEXT CHECK(status IN ('Present','Absent','Unmarked')), checked_at TEXT, source TEXT NOT NULL, admin TEXT, PRIMARY KEY(cohort,avatar,week), FOREIGN KEY(cohort,avatar) REFERENCES enrollments(cohort,avatar));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, admin TEXT, action TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
'''

class Database:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as con:
            con.executescript(SCHEMA)

    def connect(self):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA foreign_keys=ON')
        return con

    @contextmanager
    def transaction(self):
        con = self.connect()
        try:
            con.execute('BEGIN IMMEDIATE')
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
