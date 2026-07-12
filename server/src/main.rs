use std::{io, net::SocketAddr, path::PathBuf};

use clap::Parser;
use pinote_sync_server::{Store, build_router};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "pinote-sync-server", version, about = "Pinote 自托管同步服务")]
struct Cli {
    #[arg(long, env = "PINOTE_HOST", default_value = "127.0.0.1")]
    host: std::net::IpAddr,
    #[arg(long, env = "PINOTE_PORT", default_value_t = 8787)]
    port: u16,
    #[arg(long, env = "PINOTE_DATA_DIR", default_value = "./data")]
    data_dir: PathBuf,
    #[arg(long, env = "PINOTE_TOKEN_FILE")]
    token_file: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    init_tracing();

    let token = tokio::fs::read_to_string(&cli.token_file).await?;
    let token = token.trim();
    if token.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "令牌文件不能为空").into());
    }

    let database_path = cli.data_dir.join("pinote.db");
    let store = Store::open(&database_path).await?;
    let app = build_router(store, token);
    let address = SocketAddr::new(cli.host, cli.port);
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(%address, data_dir = %cli.data_dir.display(), "Pinote 同步服务已启动");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    info!("Pinote 同步服务已停止");
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}

#[cfg(unix)]
async fn shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};

    let interrupt = async {
        if let Err(cause) = tokio::signal::ctrl_c().await {
            warn!(error = %cause, "无法监听中断信号");
        }
    };
    let terminate = async {
        match signal(SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(cause) => warn!(error = %cause, "无法监听终止信号"),
        }
    };
    tokio::select! {
        () = interrupt => {},
        () = terminate => {},
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    if let Err(cause) = tokio::signal::ctrl_c().await {
        warn!(error = %cause, "无法监听中断信号");
    }
}
