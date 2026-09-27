/** 项目资产分类与文件格式。Created on 2026-09-27; Updated on 2026-09-27 @author: https://github.com/Linmoqian */
export type ProjectAssetKind = "training-data" | "model-weights" | "3d-model" | "algorithm";

export interface ProjectAssetRecord {
  id: string;
  name: string;
  fileName: string;
  kind: ProjectAssetKind;
  source: "copy" | "path";
  sizeBytes: number | null;
  path: string | null;
  createdAt: string;
}

export const ASSET_KINDS: { id: ProjectAssetKind; label: string; description: string; extensions: string[] }[] = [
  {
    id: "training-data",
    label: "训练数据",
    description: "CSV、JSON、JSONL、Parquet、Arrow、NumPy 数据",
    extensions: ["csv", "json", "jsonl", "parquet", "arrow", "npy", "npz"],
  },
  {
    id: "model-weights",
    label: "模型权重",
    description: "GGUF、Safetensors、ONNX 和常见权重文件",
    extensions: ["gguf", "safetensors", "onnx", "pt", "pth", "ckpt", "bin"],
  },
  {
    id: "3d-model",
    label: "3D 模型",
    description: "STL、OBJ、GLB、STEP、SolidWorks 等模型",
    extensions: ["stl", "obj", "glb", "gltf", "fbx", "3mf", "step", "stp", "sldprt", "sldasm", "blend", "dae"],
  },
  {
    id: "algorithm",
    label: "算法实现",
    description: "ZIP 源码归档，仅保存和下载",
    extensions: ["zip"],
  },
];

export function assetKind(id: ProjectAssetKind) {
  return ASSET_KINDS.find((kind) => kind.id === id)!;
}

export function acceptsAsset(fileName: string, kind: ProjectAssetKind): boolean {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase();
  return assetKind(kind).extensions.includes(extension ?? "");
}
