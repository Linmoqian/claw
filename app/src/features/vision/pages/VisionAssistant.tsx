// Created on 2026-09-16; updated on 2026-09-27
// @author:  https://github.com/Linmoqian

import { useEffect, type FormEvent } from "react";
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
import { isAiDesktop, type AiProviderConfig } from "../../../lib/ai";
import {
  hydrateAiSession,
  useAiSessionStore,
  type AssistantStatus,
} from "../../../stores/aiSessionStore";
import "./VisionAssistant.css";
const STATUS_LABELS: Record<AssistantStatus, string> = {
  idle: "模型未启动",
  loading: "正在加载模型",
  ready: "模型就绪",
  busy: "正在推理",
  error: "模型异常",
};

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export default function VisionAssistant() {
  const {
    status,
    config,
    messages,
    prompt,
    imagePath,
    error,
    configLoading,
    sessionActive,
    operation,
    initialize,
    setConfig,
    setPrompt,
    setImagePath,
    start: handleStart,
    stop: handleStop,
    clear: handleClear,
    pickImage: handlePickImage,
    submit,
  } = useAiSessionStore();
  const desktop = isAiDesktop();
  const canChat = sessionActive && !operation;
  const configEditable = !sessionActive && !operation && !configLoading;

  useEffect(() => {
    // 先恢复草稿再初始化，保证持久化的消息与非密钥配置不被环境配置覆盖
    void hydrateAiSession().then(() => initialize());
  }, [initialize]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };
  return (
    <div className="stage vision-assistant">
      <header className="vision-assistant__header">
        <div>
          <span className="section-label">数据与智能</span>
          <h1>视觉助手</h1>
          <p>文本对话与单图分析。会话在应用内切页时保留，关闭应用后清除。</p>
        </div>
        <BrainCircuit
          className="vision-assistant__header-icon"
          aria-hidden="true"
        />
      </header>

      <section className="vision-assistant__status" aria-live="polite">
        <span className={`vision-assistant__status-dot is-${status}`} />
        <strong>{STATUS_LABELS[status]}</strong>
        <span className="vision-assistant__status-note">
          {config.provider === "zdtaichu"
            ? "4bit · 语言模型 GPU · 视觉分支 CPU"
            : `${config.model || (config.provider === "llama-cpp" ? "自动识别服务模型" : "未填写模型")} · 图片${config.supportsVision ? "已启用" : "未启用"}`}
        </span>
        {status === "loading" && (
          <LoaderCircle className="vision-assistant__spin" size={16} />
        )}
      </section>

      {!desktop && (
        <div className="vision-assistant__notice">
          浏览器可预览配置与编辑问题；启动模型和选择图片需要打开桌面应用。
        </div>
      )}

      <section className="vision-assistant__config">
        <div className="vision-assistant__config-head">
          <div>
            <strong>
              <Settings2 size={15} />
              供应商配置
            </strong>
            <span>
              读取桌面默认配置，可在此临时修改；切换配置前需停止当前会话。
            </span>
          </div>
          <small>
            {configLoading
              ? "正在读取配置…"
              : configEditable
                ? "可编辑"
                : "请先停止当前会话"}
          </small>
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
                  model:
                    event.target.value === "zdtaichu"
                      ? "ZDTaichu5.0-9B"
                      : event.target.value === "llama-cpp" || current.provider === "zdtaichu"
                        ? ""
                        : current.model,
                  apiKey: "",
                  baseUrl:
                    event.target.value === "llama-cpp"
                      ? "http://127.0.0.1:8080/v1"
                      : current.baseUrl === "http://127.0.0.1:8080/v1"
                        ? "http://127.0.0.1:1234/v1"
                        : current.baseUrl,
                  supportsVision:
                    event.target.value === "zdtaichu"
                      ? true
                      : event.target.value === "llama-cpp"
                        ? false
                        : current.supportsVision,
                }))
              }
            >
              <option value="zdtaichu">ZDTaichu 本地</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="llama-cpp">llama.cpp 本地服务</option>
            </select>
          </label>
          <label>
            模型名称
            <input
              value={config.model}
              disabled={!configEditable}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder={config.provider === "llama-cpp" ? "留空自动识别已加载模型" : "例如 qwen2.5-vl"}
            />
          </label>
          {config.provider !== "zdtaichu" ? (
            <>
              <label>
                Base URL
                <input
                  value={config.baseUrl}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={config.provider === "llama-cpp" ? "http://127.0.0.1:8080/v1" : "http://127.0.0.1:1234/v1"}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={config.apiKey}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={config.provider === "llama-cpp" ? "本地服务未设置密钥时留空" : "留空使用默认密钥"}
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
              {config.provider === "llama-cpp" && (
                <p className="vision-assistant__provider-hint">
                  先启动已加载 GGUF 模型的 llama-server。图片输入仅适用于服务加载的视觉模型。
                </p>
              )}
            </>
          ) : (
            <>
              <label>
                模型目录
                <input
                  value={config.modelPath}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      modelPath: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Python 解释器
                <input
                  value={config.pythonPath}
                  disabled={!configEditable}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      pythonPath: event.target.value,
                    }))
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
          <span>切换页面可继续保留会话；更换供应商前请先停止模型。</span>
        </div>
        <div className="vision-assistant__actions">
          <button
            type="button"
            className="vision-assistant__button is-primary"
            onClick={handleStart}
            disabled={
              !desktop || sessionActive || Boolean(operation) || configLoading
            }
          >
            <Power size={16} />
            {operation === "start" ? "正在启动…" : "启动模型"}
          </button>
          <button
            type="button"
            className="vision-assistant__button"
            onClick={handleStop}
            disabled={!sessionActive || Boolean(operation)}
          >
            <XCircle size={16} />
            {operation === "stop" ? "正在停止…" : "停止模型"}
          </button>
          <button
            type="button"
            className="vision-assistant__button"
            onClick={handleClear}
            disabled={
              Boolean(operation) || (messages.length === 0 && !imagePath)
            }
          >
            <Trash2 size={16} />
            {operation === "clear" ? "正在清空…" : "清空对话"}
          </button>
        </div>
      </section>

      <section className="vision-assistant__chat" aria-label="视觉助手对话">
        <div className="vision-assistant__messages">
          {messages.length === 0 ? (
            <div className="vision-assistant__empty">
              <BrainCircuit size={28} />
              <strong>等待一次本地推理</strong>
              <span>
                启动模型后，可以先输入文本，也可以选择一张图片再提问。
              </span>
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

        {error && (
          <div className="vision-assistant__error" role="alert">
            {error}
          </div>
        )}

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
              aria-label="问题内容"
              placeholder={
                canChat
                  ? "输入问题，例如：请描述这张图片"
                  : "可先编辑问题，启动模型后发送"
              }
              disabled={Boolean(operation)}
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
