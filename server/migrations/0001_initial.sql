CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO sync_state (id, revision) VALUES (1, 0);

CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    markdown TEXT NOT NULL,
    color TEXT NOT NULL,
    revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
    modified_at INTEGER NOT NULL,
    modified_by TEXT NOT NULL,
    conflict_source_id TEXT,
    conflict_base_revision INTEGER
);

CREATE INDEX notes_conflict_lookup
ON notes (conflict_source_id, conflict_base_revision)
WHERE conflict_source_id IS NOT NULL;

CREATE TABLE tombstones (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
    deleted_at INTEGER NOT NULL,
    deleted_by TEXT NOT NULL
);

