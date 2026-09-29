/** 原生 IndexedDB 实验仓库：元信息、快照和采样分块在同一事务提交。
 * Created on 2026-09-26; Updated on 2026-09-29
 * @author:  https://github.com/Linmoqian
 */
import {
  openIndexedDatabase,
  requestResult,
  runWrite,
} from "../../../services/indexedDb";
import type {
  ExperimentBundle,
  ExperimentRecord,
  ExperimentSample,
  ExperimentSnapshot,
} from "./types";

const LABEL = "实验";

interface SampleChunk {
  recordId: string;
  offset: number;
  samples: ExperimentSample[];
}

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDatabase({
    name: "xiakao-experiments",
    label: LABEL,
    upgrade: (db) => {
      db.createObjectStore("records", { keyPath: "id" });
      db.createObjectStore("snapshots");
      const chunks = db.createObjectStore("chunks", {
        keyPath: ["recordId", "offset"],
      });
      chunks.createIndex("recordId", "recordId");
    },
  });
}

export const indexedDbExperimentRepository = {
  async list(): Promise<ExperimentRecord[]> {
    const db = await openDatabase();
    const records = await requestResult<ExperimentRecord[]>(
      db.transaction("records").objectStore("records").getAll(),
      LABEL,
    );
    return records.sort((a, b) => b.createdAt - a.createdAt);
  },

  async write(
    record: ExperimentRecord,
    snapshot: ExperimentSnapshot,
    samples: ExperimentSample[],
    offset: number,
  ): Promise<void> {
    const db = await openDatabase();
    await runWrite(db, ["records", "snapshots", "chunks"], LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
      transaction.objectStore("snapshots").put(snapshot, record.id);
      if (samples.length) {
        const chunk: SampleChunk = { recordId: record.id, offset, samples };
        transaction.objectStore("chunks").put(chunk);
      }
    });
  },

  async get(id: string): Promise<ExperimentBundle | null> {
    const db = await openDatabase();
    const transaction = db.transaction(["records", "snapshots", "chunks"]);
    const [record, snapshot, chunks] = await Promise.all([
      requestResult<ExperimentRecord | undefined>(
        transaction.objectStore("records").get(id),
        LABEL,
      ),
      requestResult<ExperimentSnapshot | undefined>(
        transaction.objectStore("snapshots").get(id),
        LABEL,
      ),
      requestResult<SampleChunk[]>(
        transaction.objectStore("chunks").index("recordId").getAll(id),
        LABEL,
      ),
    ]);
    if (!record || !snapshot) return null;
    const samples = chunks
      .sort((a, b) => a.offset - b.offset)
      .flatMap((chunk) => chunk.samples);
    return { record, snapshot, samples };
  },

  async updateRecord(record: ExperimentRecord): Promise<void> {
    const db = await openDatabase();
    await runWrite(db, "records", LABEL, (transaction) => {
      transaction.objectStore("records").put(record);
    });
  },
};
