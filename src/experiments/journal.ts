/** 实验写入队列：事务失败不推进偏移，不丢弃内存中的采样和日志。
 * Created on 2026-09-26
 * @author:  https://github.com/Linmoqian
 */
import type {
  ExperimentBundle,
  ExperimentRecord,
  ExperimentSample,
  ExperimentSnapshot,
} from "./types";

export type ExperimentWriter = (
  record: ExperimentRecord,
  snapshot: ExperimentSnapshot,
  samples: ExperimentSample[],
  offset: number,
) => Promise<void>;

export class ExperimentJournal {
  readonly bundle: ExperimentBundle;
  private committedCount = 0;
  private latestRecord: ExperimentRecord | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    bundle: ExperimentBundle,
    private readonly write: ExperimentWriter,
  ) {
    this.bundle = bundle;
  }

  append(sample: ExperimentSample): void {
    this.bundle.samples.push(sample);
    this.bundle.record.sampleCount = this.bundle.samples.length;
    this.bundle.record.durationS = sample.t;
  }

  get committedRecord(): ExperimentRecord | null {
    return this.latestRecord ? { ...this.latestRecord } : null;
  }

  flush(): Promise<void> {
    const task = this.pending
      .catch(() => undefined)
      .then(async () => {
        const count = this.bundle.samples.length;
        const record = { ...this.bundle.record };
        const snapshot = structuredClone(this.bundle.snapshot);
        const samples = this.bundle.samples.slice(this.committedCount, count);
        await this.write(record, snapshot, samples, this.committedCount);
        this.committedCount = count;
        this.latestRecord = record;
      });
    this.pending = task;
    return task;
  }
}
