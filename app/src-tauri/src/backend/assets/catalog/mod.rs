// 数字资产 SQLite 主存储与旧清单恢复。Created on 2026-09-28
// Updated on 2026-09-30
// @author:  https://github.com/Linmoqian

use super::{bucket_path, latest_manifest, record_id};
use crate::backend::perf;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// v1：三张资产表与索引；v2：恢复状态表。事务与 user_version 由迁移库托管。
const SCHEMA_V1: &str = include_str!("schema.sql");
const SCHEMA_V2: &str = "CREATE TABLE IF NOT EXISTS asset_catalog_state (bucket TEXT PRIMARY KEY CHECK (bucket IN ('documents', 'project-assets')), initialized_at TEXT NOT NULL);";
const EXPECTED_VERSION: i64 = 2;

const MIGRATIONS_SQL: &[M<'static>] = &[M::up(SCHEMA_V1), M::up(SCHEMA_V2)];
static MIGRATIONS: Migrations<'static> = Migrations::from_slice(MIGRATIONS_SQL);

/// 应用级唯一 SQLite 连接：启动时打开并迁移，之后所有目录操作复用。
pub struct CatalogState(Mutex<Connection>);

impl CatalogState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("assets");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let mut connection = Connection::open(directory.join("catalog.sqlite"))
            .map_err(|error| format!("无法打开数字资产数据库：{error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        // WAL 允许读写并行；NORMAL 同步级别在桌面场景兼顾持久性与性能
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("设置 WAL 失败：{error}"))?;
        connection
            .pragma_update(None, "synchronous", 1)
            .map_err(|error| format!("设置同步级别失败：{error}"))?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if version > EXPECTED_VERSION {
            return Err("数字资产数据库版本高于当前应用，请升级应用后重试".into());
        }
        MIGRATIONS
            .to_latest(&mut connection)
            .map_err(|error| format!("数字资产迁移失败：{error}"))?;
        Ok(Self(Mutex::new(connection)))
    }
}

fn recovery_marker(app: &AppHandle, bucket: &str) -> Result<PathBuf, String> {
    if bucket != "documents" && bucket != "project-assets" {
        return Err("资源分类无效".into());
    }
    Ok(bucket_path(app, bucket)?.join("catalog-recovery-needed"))
}

/** 先持久化恢复标记，后改动文件和数据库；异常退出后由下次列举修复。 */
pub(super) fn mark_recovery(app: &AppHandle, bucket: &str) -> Result<(), String> {
    if bucket == "videos" {
        return Ok(());
    }
    let marker = recovery_marker(app, bucket)?;
    if marker.exists() {
        // 前一次写入未完成时先恢复，不能用本次成功写入抹去旧恢复标记。
        list(app, bucket)?;
    }
    let mut file = fs::File::create(marker).map_err(|error| error.to_string())?;
    file.write_all(b"needed")
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

pub(super) fn clear_recovery(app: &AppHandle, bucket: &str) {
    if bucket != "videos" {
        // 删除失败仅导致下一次多做一次幂等恢复，已提交的操作仍然成功。
        let _ = recovery_marker(app, bucket)
            .and_then(|path| fs::remove_file(path).map_err(|error| error.to_string()));
    }
}

fn insert(connection: &Connection, bucket: &str, record: &Value) -> Result<(), String> {
    let id = record_id(record)?;
    let json = serde_json::to_string(record).map_err(|error| error.to_string())?;
    let name = record["name"].as_str().ok_or("资产缺少名称")?;
    let file_name = record["fileName"].as_str().ok_or("资产缺少文件名")?;
    let created_at = record["createdAt"].as_str().ok_or("资产缺少创建时间")?;
    let size = record["sizeBytes"]
        .as_u64()
        .map(i64::try_from)
        .transpose()
        .map_err(|_| "文件大小超过数据库支持范围")?;
    let path = record["path"].as_str();
    match bucket {
        "documents" => {
            let kind = record["kind"].as_str().ok_or("文档缺少分类")?;
            connection.execute(
                "INSERT OR REPLACE INTO documents (id, name, file_name, format, size_bytes, created_at, record_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, name, file_name, kind, size, created_at, json],
            )
        }
        "project-assets" => match record["kind"].as_str() {
            Some("3d-model" | "model-weights") => connection.execute(
                "INSERT OR REPLACE INTO models (id, name, file_name, model_kind, source, size_bytes, file_path, created_at, record_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![id, name, file_name, record["kind"].as_str(), record["source"].as_str(), size, path, created_at, json],
            ),
            Some("training-data") => connection.execute(
                "INSERT OR REPLACE INTO training_data (id, name, file_name, source, size_bytes, file_path, created_at, record_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, name, file_name, record["source"].as_str(), size, path, created_at, json],
            ),
            Some("algorithm") => return Ok(()),
            _ => return Err("资产分类无效".into()),
        },
        "videos" => return Ok(()),
        _ => return Err("资源分类无效".into()),
    }
    .map_err(|error| format!("数字资产索引写入失败：{error}"))?;
    Ok(())
}

pub(super) fn upsert(app: &AppHandle, bucket: &str, record: &Value) -> Result<(), String> {
    if bucket == "videos" || record["kind"] == "algorithm" {
        return Ok(());
    }
    let state = app.state::<CatalogState>();
    let connection = state.0.lock();
    insert(&connection, bucket, record)
}

pub(super) fn remove(app: &AppHandle, bucket: &str, id: &str) -> Result<(), String> {
    if bucket == "videos" {
        return Ok(());
    }
    let state = app.state::<CatalogState>();
    let connection = state.0.lock();
    match bucket {
        "documents" => connection.execute("DELETE FROM documents WHERE id = ?1", [id]),
        "project-assets" => connection
            .execute("DELETE FROM models WHERE id = ?1", [id])
            .and_then(|_| connection.execute("DELETE FROM training_data WHERE id = ?1", [id])),
        _ => return Err("资源分类无效".into()),
    }
    .map_err(|error| format!("数字资产索引删除失败：{error}"))?;
    Ok(())
}

fn records(connection: &Connection, table: &str) -> Result<Vec<Value>, String> {
    // 表名仅来自此函数内固定分支，绝不接收前端字符串。
    let sql = match table {
        "models" => "SELECT record_json FROM models",
        "training_data" => "SELECT record_json FROM training_data",
        "documents" => "SELECT record_json FROM documents",
        _ => return Err("数字资产表无效".into()),
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let json = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&json).map_err(|error| format!("数字资产元信息损坏：{error}"))
    })
    .collect()
}

fn recover_from_manifests(
    app: &AppHandle,
    bucket: &str,
    connection: &mut Connection,
) -> Result<(), String> {
    let initialized: Option<String> = connection
        .query_row(
            "SELECT bucket FROM asset_catalog_state WHERE bucket = ?1",
            [bucket],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if initialized.is_some() && !recovery_marker(app, bucket)?.exists() {
        return Ok(());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    // 仅首次迁移或中断恢复时扫描旧清单；平时由 SQLite 负责元信息查询。
    match bucket {
        "documents" => transaction.execute("DELETE FROM documents", []),
        "project-assets" => transaction
            .execute("DELETE FROM models", [])
            .and_then(|_| transaction.execute("DELETE FROM training_data", [])),
        _ => return Err("资源分类无效".into()),
    }
    .map_err(|error| error.to_string())?;
    for entry in fs::read_dir(bucket_path(app, bucket)?)
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
            if manifest.record["kind"] == "algorithm" {
                continue;
            } else {
                insert(&transaction, bucket, &manifest.record)?;
            }
        }
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO asset_catalog_state (bucket, initialized_at) VALUES (?1, datetime('now'))",
            [bucket],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    clear_recovery(app, bucket);
    Ok(())
}

pub(super) fn list(app: &AppHandle, bucket: &str) -> Result<Vec<Value>, String> {
    if bucket != "documents" && bucket != "project-assets" {
        return Err("资源分类无效".into());
    }
    perf::timed("catalog.list", || {
        let state = app.state::<CatalogState>();
        let mut connection = state.0.lock();
        recover_from_manifests(app, bucket, &mut connection)?;
        let mut result = if bucket == "documents" {
            records(&connection, "documents")?
        } else {
            let mut models = records(&connection, "models")?;
            models.extend(records(&connection, "training_data")?);
            models
        };
        if bucket == "project-assets" {
            for entry in fs::read_dir(bucket_path(app, bucket)?)
                .map_err(|error| error.to_string())?
                .filter_map(Result::ok)
            {
                if entry
                    .file_type()
                    .map_err(|error| error.to_string())?
                    .is_dir()
                {
                    if let Some(manifest) = latest_manifest(&entry.path())? {
                        if manifest.record["kind"] == "algorithm" {
                            result.push(manifest.record);
                        }
                    }
                }
            }
        }
        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_memory() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        MIGRATIONS.to_latest(&mut connection).unwrap();
        connection
    }

    #[test]
    fn migrations_reach_version_two_with_three_asset_tables() {
        let connection = migrated_memory();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, EXPECTED_VERSION);
        for table in ["models", "training_data", "documents"] {
            let exists: Option<String> = connection
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .optional()
                .unwrap();
            assert_eq!(exists.as_deref(), Some(table));
        }
    }

    #[test]
    fn indexes_supported_asset_kinds_without_collapsing_model_types() {
        let connection = migrated_memory();
        for (id, bucket, kind) in [
            ("m1", "project-assets", "3d-model"),
            ("m2", "project-assets", "model-weights"),
            ("t1", "project-assets", "training-data"),
            ("d1", "documents", "pdf"),
        ] {
            let record = serde_json::json!({
                "id": id, "name": id, "fileName": format!("{id}.bin"),
                "kind": kind, "source": "copy", "sizeBytes": 12,
                "createdAt": "2026-09-28T00:00:00Z"
            });
            insert(&connection, bucket, &record).unwrap();
        }
        assert_eq!(records(&connection, "models").unwrap().len(), 2);
        assert_eq!(records(&connection, "training_data").unwrap().len(), 1);
        assert_eq!(records(&connection, "documents").unwrap().len(), 1);
    }
}
