// 实验记录的原子落盘与分块读取。Created on 2026-09-28
// @author:  https://github.com/Linmoqian

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub struct ExperimentLock(pub Mutex<()>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRecord {
    id: String,
    name: String,
    source: String,
    status: String,
    created_at: u64,
    ended_at: Option<u64>,
    duration_s: f64,
    sample_count: usize,
    robot_id: String,
    robot_label: String,
    sample_rate_hz: u8,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSample {
    t: f64,
    timestamp_ms: u64,
    joints: BTreeMap<String, f64>,
    base: BasePose,
    tcp_position_m: [f64; 3],
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BasePose {
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChunkRef {
    offset: usize,
    file: String,
    count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
struct Manifest {
    record: ExperimentRecord,
    snapshot: serde_json::Value,
    chunks: Vec<ChunkRef>,
}

#[derive(Serialize)]
pub struct ExperimentBundle {
    record: ExperimentRecord,
    snapshot: serde_json::Value,
    samples: Vec<ExperimentSample>,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("实验 ID 无效".into());
    }
    Ok(())
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("experiments");
    fs::create_dir_all(&directory).map_err(|error| format!("创建实验目录失败：{error}"))?;
    Ok(directory)
}

fn record_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    Ok(root(app)?.join(id))
}

fn unique_name(prefix: &str) -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{time:032}-{sequence:016}.json")
}

// 每次提交使用新文件名。Windows 不必替换已存在文件；崩溃留下的 .tmp 不会成为记录。
fn atomic_new_file(directory: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let pending = directory.join(format!("{name}.tmp"));
    fs::write(&pending, bytes).map_err(|error| format!("写入实验临时文件失败：{error}"))?;
    fs::rename(&pending, directory.join(name)).map_err(|error| format!("提交实验文件失败：{error}"))
}

fn latest_manifest(directory: &Path) -> Result<Option<(PathBuf, Manifest)>, String> {
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
    let value = fs::read(&path).map_err(|error| format!("读取实验记录失败：{error}"))?;
    let manifest = serde_json::from_slice(&value)
        .map_err(|error| format!("实验记录损坏，原文件已保留：{error}"))?;
    Ok(Some((path, manifest)))
}

fn validate_record(record: &ExperimentRecord) -> Result<(), String> {
    validate_id(&record.id)?;
    if record.sample_rate_hz != 20
        || !record.duration_s.is_finite()
        || record.duration_s < 0.0
        || !["recording", "saved", "interrupted"].contains(&record.status.as_str())
    {
        return Err("实验元信息无效".into());
    }
    Ok(())
}

fn commit_manifest(directory: &Path, manifest: &Manifest) -> Result<(), String> {
    let name = unique_name("manifest");
    let bytes = serde_json::to_vec(manifest).map_err(|error| error.to_string())?;
    atomic_new_file(directory, &name, &bytes)?;
    // 只删除旧版本清单；新清单已经完整提交，采样块仍保持可追溯。
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
pub fn experiment_list(
    app: AppHandle,
    lock: State<ExperimentLock>,
) -> Result<Vec<ExperimentRecord>, String> {
    let _guard = lock.0.lock().map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for entry in fs::read_dir(root(&app)?)
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
        if let Some((_, manifest)) = latest_manifest(&entry.path())? {
            records.push(manifest.record);
        }
    }
    records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(records)
}

#[tauri::command]
pub fn experiment_write(
    app: AppHandle,
    lock: State<ExperimentLock>,
    record: ExperimentRecord,
    snapshot: serde_json::Value,
    samples: Vec<ExperimentSample>,
    offset: usize,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|error| error.to_string())?;
    validate_record(&record)?;
    if samples.iter().any(|sample| {
        !sample.t.is_finite()
            || sample.t < 0.0
            || sample.joints.values().any(|angle| !angle.is_finite())
            || sample.tcp_position_m.iter().any(|value| !value.is_finite())
    }) {
        return Err("实验采样包含无效 SI 数值".into());
    }
    let directory = record_dir(&app, &record.id)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut chunks = latest_manifest(&directory)?
        .map(|(_, manifest)| manifest.chunks)
        .unwrap_or_default();
    if !samples.is_empty() {
        let name = unique_name("chunk");
        let bytes = serde_json::to_vec(&samples).map_err(|error| error.to_string())?;
        atomic_new_file(&directory, &name, &bytes)?;
        chunks.retain(|chunk| chunk.offset != offset);
        chunks.push(ChunkRef {
            offset,
            file: name,
            count: samples.len(),
        });
        chunks.sort_by_key(|chunk| chunk.offset);
    }
    commit_manifest(
        &directory,
        &Manifest {
            record,
            snapshot,
            chunks,
        },
    )
}

#[tauri::command]
pub fn experiment_get(
    app: AppHandle,
    lock: State<ExperimentLock>,
    id: String,
) -> Result<Option<ExperimentBundle>, String> {
    let _guard = lock.0.lock().map_err(|error| error.to_string())?;
    let directory = record_dir(&app, &id)?;
    let Some((_, manifest)) = latest_manifest(&directory)? else {
        return Ok(None);
    };
    let mut samples = Vec::new();
    for chunk in &manifest.chunks {
        let bytes = fs::read(directory.join(&chunk.file))
            .map_err(|error| format!("读取实验采样失败：{error}"))?;
        let values: Vec<ExperimentSample> = serde_json::from_slice(&bytes)
            .map_err(|error| format!("实验采样损坏，原文件已保留：{error}"))?;
        if values.len() != chunk.count {
            return Err("实验采样块长度不匹配".into());
        }
        samples.extend(values);
    }
    Ok(Some(ExperimentBundle {
        record: manifest.record,
        snapshot: manifest.snapshot,
        samples,
    }))
}

#[tauri::command]
pub fn experiment_update_record(
    app: AppHandle,
    lock: State<ExperimentLock>,
    record: ExperimentRecord,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|error| error.to_string())?;
    validate_record(&record)?;
    let directory = record_dir(&app, &record.id)?;
    let (_, mut manifest) = latest_manifest(&directory)?.ok_or("实验记录不存在")?;
    manifest.record = record;
    commit_manifest(&directory, &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_manifest_ignores_unfinished_write() {
        let directory =
            std::env::temp_dir().join(format!("claw-experiment-test-{}", unique_name("case")));
        fs::create_dir_all(&directory).unwrap();
        let manifest = Manifest {
            record: ExperimentRecord {
                id: "test-record".into(),
                name: "测试".into(),
                source: "studio".into(),
                status: "recording".into(),
                created_at: 1,
                ended_at: None,
                duration_s: 0.0,
                sample_count: 0,
                robot_id: "so100".into(),
                robot_label: "SO-100".into(),
                sample_rate_hz: 20,
            },
            snapshot: serde_json::json!({"jointMapping": []}),
            chunks: Vec::new(),
        };
        commit_manifest(&directory, &manifest).unwrap();
        fs::write(directory.join("manifest-999999.tmp"), b"incomplete").unwrap();
        let (_, loaded) = latest_manifest(&directory).unwrap().unwrap();
        assert_eq!(loaded.record.name, "测试");
        fs::remove_dir_all(&directory).unwrap();
    }
}
