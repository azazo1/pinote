use std::{path::Path, str::FromStr, sync::Arc, time::Duration};

use sqlx::{
    FromRow, Sqlite, SqlitePool, Transaction,
    migrate::MigrateError,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use thiserror::Error;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::model::{DeleteChange, NoteChange, SyncNote, SyncRequest, SyncResponse, Tombstone};

const CONFLICT_SUFFIX: &str = " (冲突副本)";
const MAX_TITLE_CHARS: usize = 200;

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
    writer: Arc<Mutex<()>>,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("无法创建数据目录: {0}")]
    CreateDataDirectory(#[source] std::io::Error),
    #[error("数据库连接失败: {0}")]
    Database(#[from] sqlx::Error),
    #[error("数据库迁移失败: {0}")]
    Migration(#[from] MigrateError),
}

#[derive(Clone, Debug, FromRow)]
struct NoteRow {
    id: String,
    title: String,
    markdown: String,
    color: String,
    revision: i64,
    modified_at: i64,
    modified_by: String,
}

#[derive(Clone, Debug, FromRow)]
struct TombstoneRow {
    id: String,
    revision: i64,
    deleted_at: i64,
}

impl Store {
    pub async fn open(database_path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = database_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(StoreError::CreateDataDirectory)?;
        }

        let options = SqliteConnectOptions::from_str("sqlite://pinote.db")?
            .filename(database_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::migrate!().run(&pool).await?;

        Ok(Self {
            pool,
            writer: Arc::new(Mutex::new(())),
        })
    }

    pub async fn is_ready(&self) -> Result<(), StoreError> {
        sqlx::query_scalar::<_, i64>("SELECT 1")
            .fetch_one(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn sync(&self, request: SyncRequest) -> Result<SyncResponse, StoreError> {
        let _writer = self.writer.lock().await;
        let mut transaction = self.pool.begin().await?;
        let seen_at = unix_timestamp_millis();
        sqlx::query(
            "INSERT INTO devices (id, last_seen_at) VALUES (?, ?) \
             ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        )
        .bind(&request.device_id)
        .bind(seen_at)
        .execute(&mut *transaction)
        .await?;

        let mut conflicts = Vec::new();
        for change in &request.changes {
            apply_change(&mut transaction, change, &mut conflicts).await?;
        }
        for deletion in &request.deletions {
            apply_deletion(&mut transaction, deletion, &request.device_id).await?;
        }

        let notes = sqlx::query_as::<_, NoteRow>(
            "SELECT id, title, markdown, color, revision, modified_at, modified_by \
             FROM notes ORDER BY revision, id",
        )
        .fetch_all(&mut *transaction)
        .await?
        .into_iter()
        .map(SyncNote::from)
        .collect();
        let deleted = sqlx::query_as::<_, TombstoneRow>(
            "SELECT id, revision, deleted_at FROM tombstones ORDER BY revision, id",
        )
        .fetch_all(&mut *transaction)
        .await?
        .into_iter()
        .map(Tombstone::from)
        .collect();

        transaction.commit().await?;
        Ok(SyncResponse {
            notes,
            deleted,
            conflicts,
        })
    }
}

async fn apply_change(
    transaction: &mut Transaction<'_, Sqlite>,
    change: &NoteChange,
    conflicts: &mut Vec<SyncNote>,
) -> Result<(), sqlx::Error> {
    let current = sqlx::query_as::<_, NoteRow>(
        "SELECT id, title, markdown, color, revision, modified_at, modified_by \
         FROM notes WHERE id = ?",
    )
    .bind(&change.id)
    .fetch_optional(&mut **transaction)
    .await?;

    if let Some(current) = current {
        if current.matches(change) {
            return Ok(());
        }
        if current.revision == change.base_revision {
            let revision = next_revision(transaction).await?;
            sqlx::query(
                "UPDATE notes SET title = ?, markdown = ?, color = ?, revision = ?, \
                 modified_at = ?, modified_by = ? WHERE id = ?",
            )
            .bind(&change.title)
            .bind(&change.markdown)
            .bind(&change.color)
            .bind(revision)
            .bind(change.modified_at)
            .bind(&change.modified_by)
            .bind(&change.id)
            .execute(&mut **transaction)
            .await?;
            return Ok(());
        }

        conflicts.push(insert_or_find_conflict(transaction, change).await?);
        return Ok(());
    }

    let tombstone_revision = sqlx::query_scalar::<_, i64>(
        "SELECT revision FROM tombstones WHERE id = ?",
    )
    .bind(&change.id)
    .fetch_optional(&mut **transaction)
    .await?;
    if change.base_revision == 0 && tombstone_revision.is_none() {
        let revision = next_revision(transaction).await?;
        sqlx::query(
            "INSERT INTO notes \
             (id, title, markdown, color, revision, modified_at, modified_by) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&change.id)
        .bind(&change.title)
        .bind(&change.markdown)
        .bind(&change.color)
        .bind(revision)
        .bind(change.modified_at)
        .bind(&change.modified_by)
        .execute(&mut **transaction)
        .await?;
    } else {
        conflicts.push(insert_or_find_conflict(transaction, change).await?);
    }
    Ok(())
}

async fn insert_or_find_conflict(
    transaction: &mut Transaction<'_, Sqlite>,
    change: &NoteChange,
) -> Result<SyncNote, sqlx::Error> {
    let title = conflict_title(&change.title);
    let existing = sqlx::query_as::<_, NoteRow>(
        "SELECT id, title, markdown, color, revision, modified_at, modified_by FROM notes \
         WHERE conflict_source_id = ? AND conflict_base_revision = ? AND title = ? \
         AND markdown = ? AND color = ? AND modified_at = ? AND modified_by = ? \
         ORDER BY revision LIMIT 1",
    )
    .bind(&change.id)
    .bind(change.base_revision)
    .bind(&title)
    .bind(&change.markdown)
    .bind(&change.color)
    .bind(change.modified_at)
    .bind(&change.modified_by)
    .fetch_optional(&mut **transaction)
    .await?;
    if let Some(existing) = existing {
        return Ok(existing.into());
    }

    let id = Uuid::new_v4().to_string();
    let revision = next_revision(transaction).await?;
    sqlx::query(
        "INSERT INTO notes \
         (id, title, markdown, color, revision, modified_at, modified_by, \
          conflict_source_id, conflict_base_revision) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&change.markdown)
    .bind(&change.color)
    .bind(revision)
    .bind(change.modified_at)
    .bind(&change.modified_by)
    .bind(&change.id)
    .bind(change.base_revision)
    .execute(&mut **transaction)
    .await?;

    Ok(SyncNote {
        id,
        title,
        markdown: change.markdown.clone(),
        color: change.color.clone(),
        revision,
        modified_at: change.modified_at,
        modified_by: change.modified_by.clone(),
    })
}

async fn apply_deletion(
    transaction: &mut Transaction<'_, Sqlite>,
    deletion: &DeleteChange,
    device_id: &str,
) -> Result<(), sqlx::Error> {
    let current_revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM notes WHERE id = ?")
        .bind(&deletion.id)
        .fetch_optional(&mut **transaction)
        .await?;
    if current_revision != Some(deletion.base_revision) {
        return Ok(());
    }

    let revision = next_revision(transaction).await?;
    sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(&deletion.id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query(
        "INSERT INTO tombstones (id, revision, deleted_at, deleted_by) VALUES (?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, \
         deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by",
    )
    .bind(&deletion.id)
    .bind(revision)
    .bind(deletion.deleted_at)
    .bind(device_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn next_revision(transaction: &mut Transaction<'_, Sqlite>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE sync_state SET revision = revision + 1 WHERE id = 1 RETURNING revision",
    )
    .fetch_one(&mut **transaction)
    .await
}

fn conflict_title(title: &str) -> String {
    let available = MAX_TITLE_CHARS.saturating_sub(CONFLICT_SUFFIX.chars().count());
    let mut value: String = title.chars().take(available).collect();
    value.push_str(CONFLICT_SUFFIX);
    value
}

fn unix_timestamp_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

impl NoteRow {
    fn matches(&self, change: &NoteChange) -> bool {
        self.title == change.title
            && self.markdown == change.markdown
            && self.color == change.color
            && self.modified_at == change.modified_at
            && self.modified_by == change.modified_by
    }
}

impl From<NoteRow> for SyncNote {
    fn from(value: NoteRow) -> Self {
        Self {
            id: value.id,
            title: value.title,
            markdown: value.markdown,
            color: value.color,
            revision: value.revision,
            modified_at: value.modified_at,
            modified_by: value.modified_by,
        }
    }
}

impl From<TombstoneRow> for Tombstone {
    fn from(value: TombstoneRow) -> Self {
        Self {
            id: value.id,
            revision: value.revision,
            deleted_at: value.deleted_at,
        }
    }
}

