// Created on 2026-09-16; updated on 2026-09-17
// @author:  https://github.com/Linmoqian

import { useEffect, useState, type FormEvent } from "react";
import {
  BrainCircuit,
  ImagePlus,
  LoaderCircle,
  Power,
  Send,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  chatWithAi,
  clearAiConversation,
  getAiConfig,
  isAiDesktop,
  selectAiImage,
  startAi,
  stopAi,
  type AiProviderConfig,
} from "../lib/ai";
import "./VisionAssistant.css";

type AssistantStatus = "idle" | "loading" | "ready" | "busy" | "error";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageName?: string;
};

const STATUS_LABELS: Record<AssistantStatus, string> = {
  idle: "模型未启动",
  loading: "正在加载模型",
  ready: "模型就绪",
  busy: "正在推理",
  error: "模型异常",
};

const FALLBACK_CONFIG: AiProviderConfig = {
  provider: "zdtaichu",
  model: "ZDTaichu5.0-9B",
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  supportsVision: true,
  maxTokens: 128,
  modelPath: "D:\\models\\ZDTaichu5.0-9B",
  pythonPath: "C:\\Users\\30470\\Anaconda3\\envs\\zdtaichu\\python.exe",
};

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function nextMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function VisionAssistant() {
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [config, setConfig] = useState<AiProviderConfig>(FALLBACK_CONFIG);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const desktop = isAiDesktop();
  const canChat = status === "ready";
  const configEditable = status === "idle" || status === "error";

  useEffect(() => {
    if (!desktop) return;
    getAiConfig().then(setConfig).catch((reason) => setError(String(reason)));
  }, [desktop]);

  const handleStart = async () => {
    if (!desktop) {
      setError("视觉助手需要在 Tauri 桌面端运行。");
      return;
    }
    setError(null);
    setStatus("loading");
    try {
      await startAi(config);
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(String(reason));
    }
  };

  const handleStop = async () => {
    setError(null);
    try {
      await stopAi();
      setStatus("idle");
    } catch (reason) {
      setStatus("error");
      setError(String(reason));
    }
  };

  const handlePickImage = async () => {
    if (!desktop) {
      setError("图片选择仅在 Tauri 桌面端可用。");
      return;
    }
    if (!config.supportsVision) {
      setError("当前供应商未启用图片输入，请在配置中打开“支持图片输入”。");
      return;
    }
    setError(null);
    try {
      const selected = await selectAiImage();
      if (selected) setImagePath(selected);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const handleClear = async () => {
    if (status === "idle") {
      setMessages([]);
      setImagePath(null);
      return;
    }
    setError(null);
    try {
      await clearAiConversation();
      setMessages([]);
      setImagePath(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setMessages([]);
      setImagePath(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || !canChat) return;

    const pendingImage = imagePath;
    if (pendingImage && !config.supportsVision) {
      setError("当前供应商未启用图片输入，请先更换供应商或打开图片能力。");
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: nextMessageId(),
        role: "user",
        text,
        imageName: pendingImage ? fileNameOf(pendingImage) : undefined,
      },
    ]);
    setPrompt("");
    setImagePath(null);
    setError(null);
    setStatus("busy");

    try {
      const answer = await chatWithAi(text, pendingImage ?? undefined);
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "assistant", text: answer },
      ]);
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(String(reason));
    }
  };

  return (
    <div className="stage vision-assistant">
      <header className="vision-assistant__header">
        <div>
          <span className="section-label">LOCAL MULTIMODAL ASSISTANT</span>
          <h1>视觉助手</h1>
          <p>
          使用可切换的本地模型或 OpenAI-compatible 供应商进行文本聊天和单图分析。
          </p>
        </div>
        <BrainCircuit className="vision-assistant__header-icon" aria-hidden="true" />
      </header>

      <section className="vision-assistant__status" aria-live="polite">
        <span className={`vision-assistant__status-dot is-${status}`} />
        <strong>{STATUS_LABELS[status]}</strong>
        <span className="vision-assistant__status-note">
          {config.provider === "zdtaichu"
            ? "4bit · 语言模型 GPU · 视觉分支 CPU"
            : `${config.model || "未填写模型"} · 图片${config.supportsVision ? "已启用" : "未启用"}`}
        </span>
        {status === "loading" && (
          <LoaderCircle className="vision-assistant__spin" size={16} />
        )}
      </section>

      {!desktop && (
        <div className="vision-assistant__notice">
          当前是浏览器预览模式。请使用 <code>pnpm run tauri dev</code> 才能启动本地模型和文件选择器。
        </div>
      )}

      <section className="vision-assistant__config">
        <div className="vision-assistant__config-head">
          <div>
            <strong>
              <Settings2 size={15} />
              供应商配置
            </strong>
            <span>来自 .env 的值可在这里临时覆盖，修改后需停止并重新启动模型。</span>
          </div>
          <small>{configEditable ? "可编辑" : "请先停止当前会话"}</small>
        </div>
        <div className="vision-assistant__config-grid">
          <label>
            供应商
            <select
              value={config.provider}
              disabled={!configEditable}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  provider: event.target.value as AiProviderConfig["provider"],
                  supportsVision:
                    event.target.value === "zdtaichu" || current.supportsVision,
                }))
              }
            >
              <option value="zdtaichu">ZDTaichu 本地</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label>
            模型名称
            <input
              value={config.model}
              disabled={!configEditable}
              onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))}
              placeholder="例如 qwen2.5-vl"
            />
          </label>
          {config.provider === "openai-compatible" ? (
            <>
              <label>
                Base URL
                <input
                  value={config.baseUrl}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="http://127.0.0.1:1234/v1"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={config.apiKey}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder="留空则使用 .env"
                />
              </label>
              <label className="vision-assistant__check">
                <input
                  type="checkbox"
                  checked={config.supportsVision}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      supportsVision: event.target.checked,
                    }))
                  }
                />
                支持图片输入
              </label>
            </>
          ) : (
            <>
              <label>
                模型目录
                <input
                  value={config.modelPath}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, modelPath: event.target.value }))
                  }
                />
              </label>
              <label>
                Python 解释器
                <input
                  value={config.pythonPath}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, pythonPath: event.target.value }))
                  }
                />
              </label>
            </>
          )}
        </div>
      </section>

      <section className="vision-assistant__toolbar">
        <div>
          <strong>模型会话</strong>
          <span>首次启动会加载模型，之后连续对话不会重复加载。</span>
        </div>
        <div className="vision-assistant__actions">
          <button
            type="button"
            className="vision-assistant__button is-primary"
            onClick={handleStart}
            disabled={!desktop || status === "loading" || status === "ready" || status === "busy"}
          >
            <Power size={16} />
            启动模型
          </button>
          <button
            type="button"
            className="vision-assistant__button"
            onClick={handleStop}
            disabled={status === "idle" || status === "loading" || status === "busy"}
          >
            <XCircle size={16} />
            停止模型
          </button>
          <button
            type="button"
            className="vision-assistant__button"
            onClick={handleClear}
            disabled={
              status === "loading" ||
              status === "busy" ||
              (messages.length === 0 && !imagePath)
            }
          >
            <Trash2 size={16} />
            清空对话
          </button>
        </div>
      </section>

      <section className="vision-assistant__chat" aria-label="视觉助手对话">
        <div className="vision-assistant__messages">
          {messages.length === 0 ? (
            <div className="vision-assistant__empty">
              <BrainCircuit size={28} />
              <strong>等待一次本地推理</strong>
              <span>启动模型后，可以先输入文本，也可以选择一张图片再提问。</span>
            </div>
          ) : (
            messages.map((message) => (
              <article
                className={`vision-assistant__message is-${message.role}`}
                key={message.id}
              >
                <span className="vision-assistant__message-role">
                  {message.role === "user" ? "你" : "模型"}
                </span>
                {message.imageName && (
                  <span className="vision-assistant__image-tag">
                    <ImagePlus size={13} />
                    {message.imageName}
                  </span>
                )}
                <p>{message.text}</p>
              </article>
            ))
          )}
        </div>

        {error && <div className="vision-assistant__error">{error}</div>}

        <form className="vision-assistant__composer" onSubmit={handleSubmit}>
          {imagePath && (
            <div className="vision-assistant__selected-image">
              <ImagePlus size={15} />
              <span>{fileNameOf(imagePath)}</span>
              <button
                type="button"
                aria-label="移除待发送图片"
                onClick={() => setImagePath(null)}
              >
                <XCircle size={15} />
              </button>
            </div>
          )}
          <div className="vision-assistant__composer-row">
            <button
              type="button"
              className="vision-assistant__icon-button"
              onClick={handlePickImage}
              disabled={!desktop || !canChat}
              title="选择图片"
              aria-label="选择图片"
            >
              <ImagePlus size={18} />
            </button>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={canChat ? "输入问题，例如：请描述这张图片" : "请先启动模型"}
              disabled={!canChat}
              rows={2}
            />
            <button
              type="submit"
              className="vision-assistant__send"
              disabled={!canChat || !prompt.trim()}
              aria-label="发送问题"
            >
              <Send size={17} />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
