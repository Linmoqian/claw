-- 数字资产元信息表；大文件仍由现有原子提交的文件清单引用。
BEGIN;
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    model_kind TEXT NOT NULL CHECK (model_kind IN ('3d-model', 'model-weights')),
    source TEXT NOT NULL CHECK (source IN ('copy', 'path')),
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    file_path TEXT,
    created_at TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS training_data (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('copy', 'path')),
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    file_path TEXT,
    created_at TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('pdf', 'markdown')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    created_at TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_created_at ON models(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_data_created_at ON training_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
PRAGMA user_version = 1;
COMMIT;
