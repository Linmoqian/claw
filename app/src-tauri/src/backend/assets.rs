// 文档、视频和项目文件的分块存储。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

mod catalog;

pub(crate) use catalog::CatalogState;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static ASSET_CATALOG_LOCK: Mutex<()> = Mutex::new(());
const MAX_CHUNK: usize = 1024 * 1024;

pub struct AssetManager(pub Mutex<HashMap<String, PendingUpload>>);

pub struct PendingUpload {
    bucket: String,
    directory: PathBuf,
    temp: PathBuf,
    file: File,
    record: serde_json::Value,
    written: u64,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    record: serde_json::Value,
    binary: Option<String>,
}

fn validate_segment(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 100
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("资源 ID 无效".into());
    }
    Ok(())
}

fn bucket_path(app: &AppHandle, bucket: &str) -> Result<PathBuf, String> {
    if !["documents", "videos", "project-assets"].contains(&bucket) {
        return Err("资源分类无效".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("assets")
        .join(bucket);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn asset_path(app: &AppHandle, bucket: &str, id: &str) -> Result<PathBuf, String> {
    validate_segment(id)?;
    Ok(bucket_path(app, bucket)?.join(id))
}

fn record_id(record: &serde_json::Value) -> Result<&str, String> {
    let id = record
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or("资源缺少 ID")?;
    validate_segment(id)?;
    Ok(id)
}

fn validate_record(
    bucket: &str,
    record: &serde_json::Value,
    has_binary: bool,
) -> Result<(), String> {
    record_id(record)?;
    for field in ["name", "fileName", "createdAt"] {
        if record
            .get(field)
            .and_then(serde_json::Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(format!("资源缺少 {field}"));
        }
    }
    let binary_source = match bucket {
        "documents" => {
            if !["pdf", "markdown"].contains(&record["kind"].as_str().unwrap_or("")) {
                return Err("文档分类无效".into());
            }
            true
        }
        "videos" => {
            if !["import", "path"].contains(&record["source"].as_str().unwrap_or("")) {
                return Err("视频来源无效".into());
            }
            record["source"] == "import"
        }
        "project-assets" => {
            if !["training-data", "model-weights", "3d-model", "algorithm"]
                .contains(&record["kind"].as_str().unwrap_or(""))
            {
                return Err("资产分类无效".into());
            }
            if !["copy", "path"].contains(&record["source"].as_str().unwrap_or("")) {
                return Err("资产来源无效".into());
            }
            record["source"] == "copy"
        }
        _ => return Err("资源分类无效".into()),
    };
    if binary_source != has_binary {
        return Err("资源来源与文件内容不匹配".into());
    }
    if has_binary && record["sizeBytes"].as_u64().is_none_or(|size| size == 0) {
        return Err("文件大小无效".into());
    }
    if !has_binary && record["path"].as_str().is_none_or(str::is_empty) {
        return Err("路径引用缺少文件路径".into());
    }
    Ok(())
}

fn unique_name(prefix: &str, suffix: &str) -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{time:032}-{sequence:016}.{suffix}")
}

fn latest_manifest(directory: &Path) -> Result<Option<Manifest>, String> {
    if !directory.exists() {
        return Ok(None);
    }
    let mut files = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name().is_some_and(|name| {
                name.to_string_lossy().starts_with("manifest-")
                    && name.to_string_lossy().ends_with(".json")
            })
        })
        .collect::<Vec<_>>();
    files.sort();
    let Some(path) = files.pop() else {
        return Ok(None);
    };
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("资源元信息损坏，原文件已保留：{error}"))
}

fn commit_manifest(directory: &Path, manifest: &Manifest) -> Result<(), String> {
    let name = unique_name("manifest", "json");
    let pending = directory.join(format!("{name}.tmp"));
    fs::write(
        &pending,
        serde_json::to_vec(manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(pending, directory.join(&name)).map_err(|error| error.to_string())?;
    // 新清单已提交后才回收旧清单；未引用临时文件不影响读取。
    for entry in fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.file_name().is_some_and(|file| {
            file.to_string_lossy().starts_with("manifest-")
                && file.to_string_lossy().ends_with(".json")
                && file != name.as_str()
        }) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn asset_list(app: AppHandle, bucket: String) -> Result<Vec<serde_json::Value>, String> {
    if bucket == "documents" || bucket == "project-assets" {
        let _guard = ASSET_CATALOG_LOCK
            .lock()
            .map_err(|error| error.to_string())?;
        return catalog::list(&app, &bucket);
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(bucket_path(&app, &bucket)?)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
    {
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        if let Some(manifest) = latest_manifest(&entry.path())? {
            records.push(manifest.record);
        }
    }
    Ok(records)
}

#[tauri::command]
pub fn asset_migration_done(app: AppHandle, bucket: String) -> Result<bool, String> {
    Ok(bucket_path(&app, &bucket)?
        .join("migration-v1.done")
        .exists())
}

#[tauri::command]
pub fn asset_mark_migrated(app: AppHandle, bucket: String) -> Result<(), String> {
    let directory = bucket_path(&app, &bucket)?;
    let pending = directory.join("migration-v1.tmp");
    fs::write(&pending, b"done").map_err(|error| error.to_string())?;
    fs::rename(pending, directory.join("migration-v1.done")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn asset_save_link(
    app: AppHandle,
    bucket: String,
    record: serde_json::Value,
) -> Result<(), String> {
    validate_record(&bucket, &record, false)?;
    let _guard = ASSET_CATALOG_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let directory = asset_path(&app, &bucket, record_id(&record)?)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    catalog::mark_recovery(&app, &bucket)?;
    commit_manifest(
        &directory,
        &Manifest {
            record: record.clone(),
            binary: None,
        },
    )?;
    catalog::upsert(&app, &bucket, &record)
        .map_err(|error| format!("文件清单已保存，数据库写入失败；刷新资产列表可重试：{error}"))?;
    catalog::clear_recovery(&app, &bucket);
    Ok(())
}

#[tauri::command]
pub fn asset_begin_upload(
    app: AppHandle,
    manager: State<AssetManager>,
    bucket: String,
    record: serde_json::Value,
) -> Result<String, String> {
    validate_record(&bucket, &record, true)?;
    let directory = asset_path(&app, &bucket, record_id(&record)?)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let upload_id = unique_name("upload", "session");
    let temp = directory.join(format!("{upload_id}.tmp"));
    let file = File::create(&temp).map_err(|error| error.to_string())?;
    manager.0.lock().map_err(|error| error.to_string())?.insert(
        upload_id.clone(),
        PendingUpload {
            bucket,
            directory,
            temp,
            file,
            record,
            written: 0,
        },
    );
    Ok(upload_id)
}

#[tauri::command]
pub fn asset_upload_chunk(
    manager: State<AssetManager>,
    upload_id: String,
    offset: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > MAX_CHUNK {
        return Err("资源分块须在 1 字节到 1 MiB 之间".into());
    }
    let mut sessions = manager.0.lock().map_err(|error| error.to_string())?;
    let upload = sessions
        .get_mut(&upload_id)
        .ok_or("上传会话不存在，请重新选择文件")?;
    if offset != upload.written {
        return Err("上传偏移不连续，请重新选择文件".into());
    }
    upload
        .file
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    upload.written += bytes.len() as u64;
    Ok(())
}

#[tauri::command]
pub fn asset_finish_upload(
    app: AppHandle,
    manager: State<AssetManager>,
    upload_id: String,
) -> Result<(), String> {
    let mut sessions = manager.0.lock().map_err(|error| error.to_string())?;
    let upload = sessions
        .remove(&upload_id)
        .ok_or("上传会话不存在，请重新选择文件")?;
    drop(sessions);
    if upload.written == 0 {
        drop(upload.file);
        let _ = fs::remove_file(upload.temp);
        return Err("不能保存空文件".into());
    }
    if upload.record["sizeBytes"].as_u64() != Some(upload.written) {
        drop(upload.file);
        let _ = fs::remove_file(upload.temp);
        return Err("文件大小与资源元信息不一致".into());
    }
    upload.file.sync_all().map_err(|error| error.to_string())?;
    drop(upload.file);
    let _guard = ASSET_CATALOG_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    catalog::mark_recovery(&app, &upload.bucket)?;
    let binary = unique_name("binary", "bin");
    fs::rename(&upload.temp, upload.directory.join(&binary)).map_err(|error| error.to_string())?;
    commit_manifest(
        &upload.directory,
        &Manifest {
            record: upload.record.clone(),
            binary: Some(binary),
        },
    )?;
    catalog::upsert(&app, &upload.bucket, &upload.record)
        .map_err(|error| format!("文件已保存，数据库写入失败；刷新资产列表可重试：{error}"))?;
    catalog::clear_recovery(&app, &upload.bucket);
    Ok(())
}

#[tauri::command]
pub fn asset_abort_upload(manager: State<AssetManager>, upload_id: String) -> Result<(), String> {
    if let Some(upload) = manager
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&upload_id)
    {
        drop(upload.file);
        let _ = fs::remove_file(upload.temp);
    }
    Ok(())
}

#[tauri::command]
pub fn asset_read_chunk(
    app: AppHandle,
    bucket: String,
    id: String,
    offset: u64,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if limit == 0 || limit > MAX_CHUNK {
        return Err("读取分块大小无效".into());
    }
    let directory = asset_path(&app, &bucket, &id)?;
    let manifest = latest_manifest(&directory)?.ok_or("资源不存在")?;
    let binary = manifest.binary.ok_or("此资源只有路径引用，没有本地副本")?;
    let mut file = File::open(directory.join(binary)).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; limit];
    let count = file.read(&mut bytes).map_err(|error| error.to_string())?;
    bytes.truncate(count);
    Ok(bytes)
}

#[tauri::command]
pub fn asset_remove(app: AppHandle, bucket: String, id: String) -> Result<(), String> {
    let _guard = ASSET_CATALOG_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let directory = asset_path(&app, &bucket, &id)?;
    catalog::mark_recovery(&app, &bucket)?;
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    catalog::remove(&app, &bucket, &id)?;
    catalog::clear_recovery(&app, &bucket);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_incomplete_or_mismatched_asset_metadata() {
        let record = serde_json::json!({
            "id": "video-1", "name": "示例", "fileName": "demo.mp4", "createdAt": "2026-09-28",
            "source": "import", "sizeBytes": 42,
        });
        assert!(validate_record("videos", &record, true).is_ok());
        assert!(validate_record("videos", &record, false).is_err());
        assert!(validate_record("unknown", &record, true).is_err());
        assert!(validate_segment("../escape").is_err());
    }

    #[test]
    fn pending_file_does_not_replace_committed_manifest() {
        let directory =
            std::env::temp_dir().join(format!("claw-asset-test-{}", unique_name("case", "dir")));
        fs::create_dir_all(&directory).unwrap();
        let record = serde_json::json!({"id": "asset-1", "name": "示例"});
        commit_manifest(
            &directory,
            &Manifest {
                record: record.clone(),
                binary: None,
            },
        )
        .unwrap();
        fs::write(directory.join("manifest-999999.tmp"), b"incomplete").unwrap();
        assert_eq!(latest_manifest(&directory).unwrap().unwrap().record, record);
        fs::remove_dir_all(&directory).unwrap();
    }
}
