// 后端性能计数：命名计时器的环形窗口统计。Created on 2026-09-30
// @author:  https://github.com/Linmoqian

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;

/// 每个计时器保留的最近样本数；约 2.5 秒窗口覆盖 100Hz 采样。
const WINDOW: usize = 256;

#[derive(Default)]
struct Window {
    samples: Vec<u64>,
    cursor: usize,
    filled: usize,
    total: u64,
}

impl Window {
    fn new() -> Self {
        Self {
            samples: vec![0; WINDOW],
            cursor: 0,
            filled: 0,
            total: 0,
        }
    }

    fn record(&mut self, micros: u64) {
        self.samples[self.cursor] = micros;
        self.cursor = (self.cursor + 1) % WINDOW;
        self.filled = (self.filled + 1).min(WINDOW);
        self.total += 1;
    }

    fn stat(&self) -> PerfStat {
        let mut recent: Vec<u64> = self.samples[..self.filled].to_vec();
        recent.sort_unstable();
        let sum: u64 = recent.iter().sum();
        let p99 = if recent.is_empty() {
            0
        } else {
            let index = ((recent.len() as u64 * 99) / 100).max(1) as usize - 1;
            recent[index]
        };
        PerfStat {
            window: recent.len() as u64,
            total: self.total,
            avg_us: if recent.is_empty() {
                0.0
            } else {
                sum as f64 / recent.len() as f64
            },
            max_us: recent.last().copied().unwrap_or(0),
            p99_us: p99,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStat {
    /// 窗口内样本数
    window: u64,
    /// 累计样本数（自进程启动）
    total: u64,
    avg_us: f64,
    max_us: u64,
    p99_us: u64,
}

static TIMERS: LazyLock<Mutex<HashMap<String, Window>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 记录一次命名耗时（微秒）。
pub fn record(name: &str, micros: u64) {
    TIMERS
        .lock()
        .entry(name.to_string())
        .or_insert_with(Window::new)
        .record(micros);
}

/// 计时执行闭包并记录耗时。
pub fn timed<T>(name: &str, run: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let result = run();
    record(name, started.elapsed().as_micros() as u64);
    result
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerfSnapshot {
    timers: HashMap<String, PerfStat>,
}

#[tauri::command]
pub fn perf_snapshot() -> PerfSnapshot {
    let timers = TIMERS.lock();
    PerfSnapshot {
        timers: timers
            .iter()
            .map(|(name, window)| (name.clone(), window.stat()))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_keeps_recent_samples_and_total() {
        let mut window = Window::new();
        for micros in 0..300u64 {
            window.record(micros);
        }
        assert_eq!(window.total, 300);
        assert_eq!(window.filled, WINDOW);
        // 最近 256 个样本是 44..=299
        let stat = window.stat();
        assert_eq!(stat.max_us, 299);
        assert_eq!(stat.total, 300);
    }

    #[test]
    fn p99_picks_upper_tail() {
        let mut window = Window::new();
        for micros in 0..100u64 {
            window.record(micros);
        }
        let stat = window.stat();
        assert_eq!(stat.p99_us, 98);
        assert_eq!(stat.max_us, 99);
        assert!((stat.avg_us - 49.5).abs() < 0.001);
    }

    #[test]
    fn timers_are_isolated_by_name() {
        record("perf-test-a", 10);
        record("perf-test-b", 500);
        let timers = TIMERS.lock();
        let a = timers.get("perf-test-a").unwrap().stat();
        let b = timers.get("perf-test-b").unwrap().stat();
        assert!(a.avg_us < b.avg_us);
    }

    #[test]
    fn timed_records_elapsed_time() {
        timed("perf-test-timed", || {
            std::thread::sleep(std::time::Duration::from_millis(2))
        });
        let timers = TIMERS.lock();
        let stat = timers.get("perf-test-timed").unwrap().stat();
        assert!(stat.max_us >= 1000, "2ms 睡眠应记录至少 1000us");
    }
}
