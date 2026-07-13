use std::{
    io,
    path::{Path, PathBuf},
};

use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const DEFAULT_TOKEN_FILE: &str = "pinote-token";

#[derive(Debug)]
pub struct ServerFiles {
    pub token: String,
    pub token_file: PathBuf,
    pub token_created: bool,
}

pub async fn prepare_server_files(
    data_dir: &Path,
    token_file: Option<&Path>,
) -> io::Result<ServerFiles> {
    create_directory(data_dir, "无法创建数据目录").await?;

    let token_file = token_file
        .map(Path::to_path_buf)
        .unwrap_or_else(|| data_dir.join(DEFAULT_TOKEN_FILE));
    if let Some(parent) = token_file
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        create_directory(parent, "无法创建令牌目录").await?;
    }

    match read_token(&token_file).await {
        Ok(token) => Ok(ServerFiles {
            token,
            token_file,
            token_created: false,
        }),
        Err(cause) if cause.kind() == io::ErrorKind::NotFound => {
            create_token(token_file).await
        }
        Err(cause) => Err(cause),
    }
}

async fn create_directory(path: &Path, action: &str) -> io::Result<()> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|cause| path_error(cause, action, path))
}

async fn read_token(path: &Path) -> io::Result<String> {
    let token = tokio::fs::read_to_string(path)
        .await
        .map_err(|cause| path_error(cause, "无法读取令牌文件", path))?;
    let token = token.trim();
    if token.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("令牌文件不能为空: {}", path.display()),
        ));
    }
    Ok(token.to_owned())
}

async fn create_token(token_file: PathBuf) -> io::Result<ServerFiles> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = match options.open(&token_file).await {
        Ok(file) => file,
        Err(cause) if cause.kind() == io::ErrorKind::AlreadyExists => {
            let token = read_token(&token_file).await?;
            return Ok(ServerFiles {
                token,
                token_file,
                token_created: false,
            });
        }
        Err(cause) => {
            return Err(path_error(cause, "无法创建令牌文件", &token_file));
        }
    };

    let write_result = async {
        file.write_all(format!("{token}\n").as_bytes()).await?;
        file.sync_all().await
    }
    .await;
    if let Err(cause) = write_result {
        drop(file);
        let _ = tokio::fs::remove_file(&token_file).await;
        return Err(path_error(cause, "无法写入令牌文件", &token_file));
    }

    Ok(ServerFiles {
        token,
        token_file,
        token_created: true,
    })
}

fn path_error(cause: io::Error, action: &str, path: &Path) -> io::Error {
    io::Error::new(
        cause.kind(),
        format!("{action} {}: {cause}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::prepare_server_files;

    #[tokio::test]
    async fn startup_creates_data_and_reuses_generated_token() {
        let root = TempDir::new().expect("临时目录应创建成功");
        let data_dir = root.path().join("nested/data");

        let created = prepare_server_files(&data_dir, None)
            .await
            .expect("首次启动应创建服务文件");
        assert!(created.token_created);
        assert_eq!(created.token.len(), 64);
        assert!(
            created
                .token
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        );
        assert_eq!(created.token_file, data_dir.join("pinote-token"));

        let reused = prepare_server_files(&data_dir, None)
            .await
            .expect("再次启动应读取已有令牌");
        assert!(!reused.token_created);
        assert_eq!(reused.token, created.token);
    }

    #[tokio::test]
    async fn explicit_token_file_remains_compatible() {
        let root = TempDir::new().expect("临时目录应创建成功");
        let token_file = root.path().join("run/secrets/pinote_token");
        tokio::fs::create_dir_all(token_file.parent().unwrap())
            .await
            .expect("令牌目录应创建成功");
        tokio::fs::write(&token_file, "existing-secret\n")
            .await
            .expect("测试令牌应写入成功");

        let files = prepare_server_files(&root.path().join("data"), Some(&token_file))
            .await
            .expect("显式令牌文件应正常读取");
        assert!(!files.token_created);
        assert_eq!(files.token, "existing-secret");
        assert_eq!(files.token_file, token_file);
    }
}
