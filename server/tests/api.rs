use std::path::Path;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use pinote_sync_server::{Store, build_router, model::SyncResponse};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

const TOKEN: &str = "integration-test-token";

async fn test_app(path: &Path) -> Router {
    let store = Store::open(path).await.expect("测试数据库应成功打开");
    build_router(store, TOKEN)
}

async fn send_sync(app: Router, token: &str, payload: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri("/v1/sync")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(payload.to_string()))
        .expect("测试请求应有效");
    let response = app.oneshot(request).await.expect("路由请求应成功");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("响应体应可读取")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).expect("响应体应为 JSON");
    (status, body)
}

fn change(id: &str, title: &str, markdown: &str, base_revision: i64, modified_at: i64) -> Value {
    json!({
        "id": id,
        "title": title,
        "markdown": markdown,
        "color": "lemon",
        "baseRevision": base_revision,
        "modifiedAt": modified_at,
        "modifiedBy": "device-a"
    })
}

fn request(changes: Vec<Value>, deletions: Vec<Value>) -> Value {
    json!({
        "deviceId": "device-a",
        "changes": changes,
        "deletions": deletions
    })
}

#[tokio::test]
async fn health_and_readiness_are_public_but_sync_requires_authentication() {
    let directory = TempDir::new().expect("临时目录应创建成功");
    let app = test_app(&directory.path().join("pinote.db")).await;

    for path in ["/healthz", "/readyz"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    let (status, _) = send_sync(app, "wrong-token", request(Vec::new(), Vec::new())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn revisions_update_and_stale_changes_create_an_idempotent_conflict_copy() {
    let directory = TempDir::new().expect("临时目录应创建成功");
    let app = test_app(&directory.path().join("pinote.db")).await;

    let (status, created) = send_sync(
        app.clone(),
        TOKEN,
        request(vec![change("note-1", "标题", "初稿", 0, 1_000)], Vec::new()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(created["notes"][0]["revision"], 1);

    let (_, updated) = send_sync(
        app.clone(),
        TOKEN,
        request(vec![change("note-1", "标题", "服务器版本", 1, 2_000)], Vec::new()),
    )
    .await;
    assert_eq!(updated["notes"][0]["revision"], 2);

    let stale_request = request(
        vec![change("note-1", "标题", "离线版本", 1, 3_000)],
        Vec::new(),
    );
    let (_, conflicted) = send_sync(app.clone(), TOKEN, stale_request.clone()).await;
    assert_eq!(conflicted["notes"].as_array().unwrap().len(), 2);
    assert_eq!(conflicted["conflicts"].as_array().unwrap().len(), 1);
    assert_eq!(conflicted["conflicts"][0]["revision"], 3);
    assert_eq!(conflicted["notes"][0]["markdown"], "服务器版本");

    let (_, retried) = send_sync(app, TOKEN, stale_request).await;
    assert_eq!(retried["notes"].as_array().unwrap().len(), 2);
    assert_eq!(retried["conflicts"].as_array().unwrap().len(), 1);
    assert_eq!(retried["conflicts"][0]["revision"], 3);
}

#[tokio::test]
async fn stale_deletion_preserves_newer_note_and_current_deletion_creates_tombstone() {
    let directory = TempDir::new().expect("临时目录应创建成功");
    let app = test_app(&directory.path().join("pinote.db")).await;
    send_sync(
        app.clone(),
        TOKEN,
        request(vec![change("note-1", "标题", "初稿", 0, 1_000)], Vec::new()),
    )
    .await;
    send_sync(
        app.clone(),
        TOKEN,
        request(vec![change("note-1", "标题", "新稿", 1, 2_000)], Vec::new()),
    )
    .await;

    let stale_delete = json!({ "id": "note-1", "baseRevision": 1, "deletedAt": 3_000 });
    let (_, preserved) = send_sync(
        app.clone(),
        TOKEN,
        request(Vec::new(), vec![stale_delete]),
    )
    .await;
    assert_eq!(preserved["notes"].as_array().unwrap().len(), 1);
    assert!(preserved["deleted"].as_array().unwrap().is_empty());

    let current_delete = json!({ "id": "note-1", "baseRevision": 2, "deletedAt": 4_000 });
    let (_, deleted) = send_sync(
        app,
        TOKEN,
        request(Vec::new(), vec![current_delete]),
    )
    .await;
    assert!(deleted["notes"].as_array().unwrap().is_empty());
    assert_eq!(deleted["deleted"][0]["revision"], 3);
}

#[tokio::test]
async fn sqlite_data_and_migrations_survive_service_restart() {
    let directory = TempDir::new().expect("临时目录应创建成功");
    let database_path = directory.path().join("pinote.db");
    {
        let app = test_app(&database_path).await;
        let (status, _) = send_sync(
            app,
            TOKEN,
            request(vec![change("note-1", "重启测试", "保留内容", 0, 1_000)], Vec::new()),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    let app = test_app(&database_path).await;
    let (_, snapshot) = send_sync(app, TOKEN, request(Vec::new(), Vec::new())).await;
    let parsed: SyncResponse = serde_json::from_value(snapshot).expect("响应协议应保持稳定");
    assert_eq!(parsed.notes.len(), 1);
    assert_eq!(parsed.notes[0].markdown, "保留内容");
}

#[tokio::test]
async fn invalid_payload_is_rejected_without_mutating_snapshot() {
    let directory = TempDir::new().expect("临时目录应创建成功");
    let app = test_app(&directory.path().join("pinote.db")).await;
    let invalid = json!({
        "deviceId": "device-a",
        "changes": [change("note-1", "标题", "内容", 0, 1_000), change("note-1", "标题", "重复", 0, 2_000)],
        "deletions": []
    });
    let (status, _) = send_sync(app.clone(), TOKEN, invalid).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (_, snapshot) = send_sync(app, TOKEN, request(Vec::new(), Vec::new())).await;
    assert!(snapshot["notes"].as_array().unwrap().is_empty());
}

