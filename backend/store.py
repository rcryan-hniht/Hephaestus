"""SQLite persistence and owner-private, atomic artifact writes."""

import json
import os
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = self.root / "jobs.sqlite3"
        fd = os.open(self.db, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS revisions (job_id TEXT, version INTEGER, payload TEXT NOT NULL, PRIMARY KEY(job_id,version))"
            )

    def connect(self):
        return sqlite3.connect(self.db, timeout=10)

    def save(self, job):
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO jobs VALUES (?,?)",
                (job["id"], json.dumps(job, allow_nan=False)),
            )

    def get(self, job_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM jobs WHERE id=?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM jobs").fetchall()
        return [json.loads(r[0]) for r in rows]

    def count(self):
        with self.connect() as db:
            return db.execute("SELECT count(*) FROM jobs").fetchone()[0]

    def revision(self, job_id, version):
        with self.connect() as db:
            row = db.execute(
                "SELECT payload FROM revisions WHERE job_id=? AND version=?", (job_id, version)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def publish(self, job, revision):
        # Revision and active pointer commit together; a crash cannot publish half a result.
        with self.connect() as db:
            db.execute(
                "INSERT INTO revisions VALUES (?,?,?)",
                (job["id"], revision["scene"]["revision"], json.dumps(revision, allow_nan=False)),
            )
            db.execute(
                "UPDATE jobs SET payload=? WHERE id=?",
                (json.dumps(job, allow_nan=False), job["id"]),
            )

    def write(self, job_id, filename, data):
        directory = self.root / job_id
        directory.mkdir(mode=0o700, exist_ok=True)
        target = directory / filename
        temporary = target.with_suffix(target.suffix + ".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        temporary.replace(target)

    def read_source(self, job):
        return (self.root / job["id"] / ("source." + job["source_kind"])).read_bytes()
