use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const MAX_DEVICE_ID_BYTES: usize = 128;
const MAX_NOTE_ID_BYTES: usize = 128;
const MAX_TITLE_CHARS: usize = 200;
const MAX_MARKDOWN_BYTES: usize = 2_000_000;
const MAX_COLOR_BYTES: usize = 64;
const MAX_OPERATIONS: usize = 1_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRequest {
    pub device_id: String,
    #[serde(default)]
    pub changes: Vec<NoteChange>,
    #[serde(default)]
    pub deletions: Vec<DeleteChange>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteChange {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub color: String,
    pub base_revision: i64,
    pub modified_at: i64,
    pub modified_by: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteChange {
    pub id: String,
    pub base_revision: i64,
    pub deleted_at: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncNote {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub color: String,
    pub revision: i64,
    pub modified_at: i64,
    pub modified_by: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tombstone {
    pub id: String,
    pub revision: i64,
    pub deleted_at: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub notes: Vec<SyncNote>,
    pub deleted: Vec<Tombstone>,
    pub conflicts: Vec<SyncNote>,
}

impl SyncRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_identifier("deviceId", &self.device_id, MAX_DEVICE_ID_BYTES)?;
        if self.changes.len() + self.deletions.len() > MAX_OPERATIONS {
            return Err(format!("单次同步最多允许 {MAX_OPERATIONS} 个操作"));
        }

        let mut ids = HashSet::with_capacity(self.changes.len() + self.deletions.len());
        for change in &self.changes {
            validate_identifier("便签 id", &change.id, MAX_NOTE_ID_BYTES)?;
            if !ids.insert(change.id.as_str()) {
                return Err(format!("便签 {} 在同一请求中出现多次", change.id));
            }
            if change.title.chars().count() > MAX_TITLE_CHARS {
                return Err(format!("便签 {} 的标题超过 {MAX_TITLE_CHARS} 个字符", change.id));
            }
            if change.markdown.len() > MAX_MARKDOWN_BYTES {
                return Err(format!("便签 {} 的 Markdown 内容超过大小限制", change.id));
            }
            if change.color.is_empty() || change.color.len() > MAX_COLOR_BYTES {
                return Err(format!("便签 {} 的颜色值无效", change.id));
            }
            if change.base_revision < 0 || change.modified_at <= 0 {
                return Err(format!("便签 {} 的 revision 或修改时间无效", change.id));
            }
            validate_identifier("modifiedBy", &change.modified_by, MAX_DEVICE_ID_BYTES)?;
            if change.modified_by != self.device_id {
                return Err(format!("便签 {} 的 modifiedBy 必须等于 deviceId", change.id));
            }
        }

        for deletion in &self.deletions {
            validate_identifier("便签 id", &deletion.id, MAX_NOTE_ID_BYTES)?;
            if !ids.insert(deletion.id.as_str()) {
                return Err(format!("便签 {} 在同一请求中出现多次", deletion.id));
            }
            if deletion.base_revision < 0 || deletion.deleted_at <= 0 {
                return Err(format!("便签 {} 的删除 revision 或时间无效", deletion.id));
            }
        }
        Ok(())
    }
}

fn validate_identifier(name: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(format!("{name} 无效"));
    }
    Ok(())
}
