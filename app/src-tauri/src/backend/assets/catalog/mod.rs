// 数字资产 SQLite 元信息索引与旧清单恢复。Created on 2026-09-28
// Updated on 2026-09-28
// @author:  https://github.com/Linmoqian

use super::{bucket_path, latest_manifest, record_id};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::fs;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const SCHEMA: &str = include_str!("schema.sql");

fn open(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("assets");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let connection = Connection::open(directory.join("catalog.sqlite"))
        .map_err(|error| format!("无法打开数字资产数据库：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version > 1 {
        return Err("数字资产数据库版本高于当前应用，请升级应用后重试".into());
    }
    if version == 0 {
        connection
            .execute_batch(SCHEMA)
            .map_err(|error| format!("数字资产建表失败：{error}"))?;
    }
    Ok(connection)
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
    insert(&open(app)?, bucket, record)
}

pub(super) fn remove(app: &AppHandle, bucket: &str, id: &str) -> Result<(), String> {
    if bucket == "videos" {
        return Ok(());
    }
    let connection = open(app)?;
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

pub(super) fn list(app: &AppHandle, bucket: &str) -> Result<Vec<Value>, String> {
    let mut connection = open(app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    // 清单仍保存二进制文件位置；每次列举时重建索引，可恢复文件提交后数据库写入失败的记录。
    match bucket {
        "documents" => transaction.execute("DELETE FROM documents", []),
        "project-assets" => transaction
            .execute("DELETE FROM models", [])
            .and_then(|_| transaction.execute("DELETE FROM training_data", [])),
        _ => return Err("资源分类无效".into()),
    }
    .map_err(|error| error.to_string())?;
    let mut other = Vec::new();
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
                other.push(manifest.record);
            } else {
                insert(&transaction, bucket, &manifest.record)?;
            }
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    let mut result = if bucket == "documents" {
        records(&connection, "documents")?
    } else {
        let mut models = records(&connection, "models")?;
        models.extend(records(&connection, "training_data")?);
        models
    };
    result.extend(other);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;

    #[test]
    fn creates_three_asset_tables() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
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
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
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
