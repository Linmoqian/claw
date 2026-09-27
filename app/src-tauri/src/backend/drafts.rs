// 业务草稿的原子保存与旧浏览器数据迁移入口。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_DRAFT_BYTES: usize = 10 * 1024 * 1024;

pub struct DraftStore(pub Mutex<()>);

fn folder(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !["block-console", "datasets", "tool-profiles", "active-tool"].contains(&key) {
        return Err("未知业务草稿类型".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("drafts")
        .join(key);
    fs::create_dir_all(&path).map_err(|error| format!("创建草稿目录失败：{error}"))?;
    Ok(path)
}

fn committed_files(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry| {
            entry.file_name().is_some_and(|name| {
                name.to_string_lossy().starts_with("draft-")
                    && name.to_string_lossy().ends_with(".txt")
            })
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn draft_read(
    app: AppHandle,
    state: State<DraftStore>,
    key: String,
) -> Result<Option<String>, String> {
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let path = folder(&app, &key)?;
    let Some(file) = committed_files(&path)?.pop() else {
        return Ok(None);
    };
    fs::read_to_string(file)
        .map(Some)
        .map_err(|error| format!("草稿读取失败，原文件已保留：{error}"))
}

#[tauri::command]
pub fn draft_write(
    app: AppHandle,
    state: State<DraftStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    if value.len() > MAX_DRAFT_BYTES {
        return Err("草稿超过 10 MiB 上限".into());
    }
    let _guard = state.0.lock().map_err(|error| error.to_string())?;
    let path = folder(&app, &key)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let name = format!("draft-{now:032}-{sequence:016}.txt");
    let pending = path.join(format!("{name}.tmp"));
    fs::write(&pending, value).map_err(|error| format!("草稿临时写入失败：{error}"))?;
    fs::rename(&pending, path.join(name))
        .map_err(|error| format!("草稿提交失败，原数据已保留：{error}"))?;
    let files = committed_files(&path)?;
    for old in files.into_iter().rev().skip(5) {
        let _ = fs::remove_file(old);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_and_unknown_files_are_ignored() {
        let path = std::env::temp_dir().join(format!(
            "claw-drafts-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(!path.exists());
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("draft-001.txt.tmp"), "old").unwrap();
        fs::write(path.join("draft-002.txt"), "new").unwrap();
        assert_eq!(committed_files(&path).unwrap().len(), 1);
        fs::remove_dir_all(path).unwrap();
    }
}
