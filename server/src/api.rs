use std::{convert::Infallible, time::{Duration, Instant}};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::{HeaderName, StatusCode, header},
    middleware,
    response::{IntoResponse, Response, sse::{Event, KeepAlive, Sse}},
    routing::{get, post},
};
use serde_json::json;
use tokio::sync::broadcast;
use tokio_stream::{StreamExt, wrappers::BroadcastStream};
use tracing::{error, info, warn};

use crate::{
    auth::{AuthToken, require_auth},
    model::{SyncRequest, SyncResponse},
    store::Store,
};

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const TRANSACTION_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone)]
struct AppState {
    store: Store,
    changes: broadcast::Sender<i64>,
}

pub fn build_router(store: Store, token: &str) -> Router {
    let (changes, _) = broadcast::channel(64);
    let protected = Router::new()
        .route("/v1/sync", post(sync))
        .route("/v1/events", get(events))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .route_layer(middleware::from_fn_with_state(
            AuthToken::new(token),
            require_auth,
        ));

    Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .merge(protected)
        .fallback(not_found)
        .with_state(AppState { store, changes })
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

async fn ready(State(state): State<AppState>) -> Response {
    match state.store.is_ready().await {
        Ok(()) => Json(json!({ "ready": true })).into_response(),
        Err(cause) => {
            error!(error = %cause, "同步数据库未就绪");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "ready": false, "error": "同步数据库未就绪" })),
            )
                .into_response()
        }
    }
}

async fn sync(
    State(state): State<AppState>,
    payload: Result<Json<SyncRequest>, JsonRejection>,
) -> Result<Json<SyncResponse>, ApiError> {
    let Json(request) = payload.map_err(|cause| ApiError::bad_request(cause.body_text()))?;
    request.validate().map_err(ApiError::unprocessable)?;

    let started_at = Instant::now();
    let device_id = request.device_id.clone();
    let change_count = request.changes.len();
    let deletion_count = request.deletions.len();
    let result = tokio::time::timeout(TRANSACTION_TIMEOUT, state.store.sync(request)).await;
    match result {
        Ok(Ok(response)) => {
            if response.changed {
                let _ = state.changes.send(response.revision);
            }
            info!(
                device_id,
                change_count,
                deletion_count,
                note_count = response.response.notes.len(),
                deleted_count = response.response.deleted.len(),
                conflict_count = response.response.conflicts.len(),
                revision = response.revision,
                duration_ms = started_at.elapsed().as_millis(),
                "同步请求完成"
            );
            Ok(Json(response.response))
        }
        Ok(Err(cause)) => {
            error!(
                device_id,
                change_count,
                deletion_count,
                duration_ms = started_at.elapsed().as_millis(),
                error = %cause,
                "同步事务失败"
            );
            Err(ApiError::internal())
        }
        Err(_) => {
            warn!(
                device_id,
                change_count,
                deletion_count,
                duration_ms = started_at.elapsed().as_millis(),
                "同步事务超时"
            );
            Err(ApiError::timeout())
        }
    }
}

async fn events(State(state): State<AppState>) -> impl IntoResponse {
    let ready = tokio_stream::once(Ok::<_, Infallible>(Event::default().event("ready")));
    let changes = BroadcastStream::new(state.changes.subscribe()).filter_map(|revision| {
        revision.ok().map(|revision| {
            Ok::<_, Infallible>(Event::default().event("changed").data(revision.to_string()))
        })
    });
    let stream = ready.chain(changes);
    (
        [
            (header::CACHE_CONTROL, "no-cache"),
            (HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        Sse::new(stream).keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(5))
                .text("keepalive"),
        ),
    )
}

async fn not_found() -> ApiError {
    ApiError {
        status: StatusCode::NOT_FOUND,
        message: "未找到接口".to_owned(),
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    fn unprocessable(message: String) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message,
        }
    }

    fn timeout() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "同步事务超时".to_owned(),
        }
    }

    fn internal() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "同步事务失败".to_owned(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}
