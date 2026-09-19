"""ZDTaichu5.0-9B 的常驻 JSONL 推理桥。"""

# Created on 2026-09-16; updated on 2026-09-16
# @author:  https://github.com/Linmoqian

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import torch
from PIL import Image, ImageOps
from transformers import AutoModel, AutoProcessor, BitsAndBytesConfig


DEFAULT_MODEL_PATH = r"D:\models\ZDTaichu5.0-9B"
MAX_IMAGE_SIDE = 512
SUPPORTED_PROVIDERS = ("zdtaichu", "openai-compatible")


def provider_names() -> tuple[str, ...]:
    """返回前端可选择的供应商标识。"""
    return SUPPORTED_PROVIDERS


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_provider_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    """统一前端 camelCase、环境变量和 Python 内部配置。"""
    raw = raw or {}
    provider = str(
        raw.get("provider")
        or os.environ.get("AI_PROVIDER")
        or "zdtaichu"
    ).strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"不支持的模型供应商：{provider}")

    model = str(
        raw.get("model")
        or os.environ.get("AI_MODEL")
        or ("ZDTaichu5.0-9B" if provider == "zdtaichu" else "")
    ).strip()
    base_url = str(
        raw.get("baseUrl")
        or raw.get("base_url")
        or os.environ.get("AI_BASE_URL")
        or ""
    ).strip().rstrip("/")
    api_key = str(
        raw.get("apiKey")
        or raw.get("api_key")
        or os.environ.get("AI_API_KEY")
        or ""
    ).strip()
    supports_vision = _as_bool(
        raw.get("supportsVision", raw.get("supports_vision")),
        provider == "zdtaichu",
    )
    max_tokens = int(
        raw.get("maxTokens")
        or raw.get("max_tokens")
        or os.environ.get("AI_MAX_TOKENS")
        or 128
    )
    model_path = str(
        raw.get("modelPath")
        or raw.get("model_path")
        or os.environ.get("ZDTAICHU_MODEL_PATH")
        or DEFAULT_MODEL_PATH
    ).strip()

    if provider == "openai-compatible":
        if not base_url:
            raise ValueError("OpenAI-compatible 供应商需要填写 Base URL")
        if not model:
            raise ValueError("OpenAI-compatible 供应商需要填写模型名称")

    return {
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "api_key": api_key,
        "supports_vision": supports_vision,
        "max_tokens": max(1, min(max_tokens, 512)),
        "model_path": model_path,
    }


def build_openai_user_content(
    prompt: str,
    image_data_uri: str | None,
    supports_vision: bool,
) -> str | list[dict[str, Any]]:
    """构造 OpenAI-compatible 的文本或图文 content。"""
    if image_data_uri is None:
        return prompt
    if not supports_vision:
        raise ValueError("当前供应商不支持图片输入")
    return [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": image_data_uri}},
    ]


def build_openai_request(
    config: dict[str, Any],
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """构造不包含 API Key 的 OpenAI-compatible 请求体。"""
    return {
        "model": config["model"],
        "messages": messages,
        "max_tokens": config["max_tokens"],
    }


def openai_chat_url(base_url: str) -> str:
    """将供应商 Base URL 规范化为 chat completions 地址。"""
    base_url = base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def patch_accelerate_bnb_dispatch() -> None:
    """避免 accelerate 探测 bitsandbytes 层时调用其自定义 state_dict。"""
    import accelerate.hooks as accelerate_hooks

    if getattr(accelerate_hooks, "_zdtaichu_dispatch_patched", False):
        return

    def attach_execution_device_hook(
        module,
        execution_device,
        skip_keys=None,
        preload_module_classes=None,
        tied_params_map=None,
    ):
        has_direct_state = any(
            value is not None for value in module._parameters.values()
        ) or any(value is not None for value in module._buffers.values())
        if not hasattr(module, "_hf_hook") and has_direct_state:
            accelerate_hooks.add_hook_to_module(
                module,
                accelerate_hooks.AlignDevicesHook(
                    execution_device,
                    skip_keys=skip_keys,
                    tied_params_map=tied_params_map,
                ),
            )

        if (
            preload_module_classes is not None
            and module.__class__.__name__ in preload_module_classes
        ):
            return

        for child in module.children():
            attach_execution_device_hook(
                child,
                execution_device,
                skip_keys=skip_keys,
                preload_module_classes=preload_module_classes,
                tied_params_map=tied_params_map,
            )

    accelerate_hooks.attach_execution_device_hook = attach_execution_device_hook
    accelerate_hooks._zdtaichu_dispatch_patched = True


def build_device_map() -> dict[str, int | str]:
    """让量化语言模型固定在 GPU，仅把视觉分支放到 CPU。"""
    return {
        "language_model": 0,
        "vision_model": "cpu",
        "mlp1": "cpu",
    }


def build_user_message(prompt: str, image_path: Path | None) -> dict[str, Any]:
    """构造 ZDTaichu/Qwen 风格的多模态用户消息。"""
    content: list[dict[str, str]] = []
    if image_path is not None:
        content.append({"type": "image", "image": str(image_path)})
    content.append({"type": "text", "text": prompt})
    return {"role": "user", "content": content}


def prepare_image(source: Path, output_dir: Path) -> Path:
    """把图片转成 RGB，并将最长边限制在 512px 以内。"""
    source = Path(source)
    if not source.is_file():
        raise FileNotFoundError(f"图片不存在：{source}")

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{uuid.uuid4().hex}.png"
    with Image.open(source) as image:
        prepared = ImageOps.exif_transpose(image).convert("RGB")
        prepared.thumbnail(
            (MAX_IMAGE_SIDE, MAX_IMAGE_SIDE),
            Image.Resampling.LANCZOS,
        )
        prepared.save(output, format="PNG")
    return output


def generate_answer(
    processor,
    model,
    messages: list[dict[str, Any]],
    max_new_tokens: int,
) -> str:
    """执行一次完整生成，不向前端暴露 token 流。"""
    inputs = processor.from_messages(messages, return_tensors="pt")
    inputs = inputs.to(model.device)
    with torch.inference_mode():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
        )

    generated_ids = output_ids[:, inputs["input_ids"].shape[1] :]
    return processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
    )[0].strip()


class ZDTaichuSession:
    """模型和多轮消息状态，生命周期与 Python 桥进程一致。"""

    def __init__(self, model_path: Path, max_new_tokens: int):
        if not model_path.is_dir():
            raise FileNotFoundError(f"模型目录不存在：{model_path}")
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA 不可用，停止运行以避免误用 CPU")

        patch_accelerate_bnb_dispatch()
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
            llm_int8_enable_fp32_cpu_offload=True,
        )
        self.processor = AutoProcessor.from_pretrained(
            model_path,
            trust_remote_code=True,
            use_fast=False,
        )
        self.model = AutoModel.from_pretrained(
            model_path,
            trust_remote_code=True,
            quantization_config=quant_config,
            device_map=build_device_map(),
            low_cpu_mem_usage=True,
            attn_implementation="sdpa",
        ).eval()
        self.max_new_tokens = max_new_tokens
        self.messages: list[dict[str, Any]] = []
        self.temp_dir = Path(tempfile.gettempdir()) / "xiakao-zdtaichu"
        self.temp_images: list[Path] = []

    def chat(self, prompt: str, image_path: str | None) -> str:
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("问题不能为空")

        prepared_image = None
        if image_path:
            prepared_image = prepare_image(Path(image_path), self.temp_dir)
            self.temp_images.append(prepared_image)

        message = build_user_message(prompt, prepared_image)
        self.messages.append(message)
        try:
            answer = generate_answer(
                self.processor,
                self.model,
                self.messages,
                self.max_new_tokens,
            )
        except Exception:
            self.messages.pop()
            if prepared_image is not None:
                self._remove_temp_image(prepared_image)
            raise

        self.messages.append(
            {
                "role": "assistant",
                "content": [{"type": "text", "text": answer}],
            }
        )
        return answer

    def clear(self) -> None:
        self.messages.clear()
        for image_path in self.temp_images:
            self._remove_temp_image(image_path)
        self.temp_images.clear()

    def close(self) -> None:
        self.clear()
        self.model = None
        self.processor = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _remove_temp_image(self, image_path: Path) -> None:
        try:
            image_path.unlink(missing_ok=True)
        except OSError:
            pass


def image_data_uri(image_path: Path) -> str:
    """将已经预处理的 PNG 图片编码为 OpenAI-compatible data URI。"""
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


class OpenAICompatibleSession:
    """调用 OpenAI-compatible chat completions 的多轮会话。"""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.messages: list[dict[str, Any]] = []
        self.temp_dir = Path(tempfile.gettempdir()) / "xiakao-zdtaichu"
        self.temp_images: list[Path] = []

    def chat(self, prompt: str, image_path: str | None) -> str:
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("问题不能为空")

        prepared_image = None
        message = None
        try:
            if image_path:
                prepared_image = prepare_image(Path(image_path), self.temp_dir)
                self.temp_images.append(prepared_image)
            content = build_openai_user_content(
                prompt,
                image_data_uri(prepared_image) if prepared_image else None,
                self.config["supports_vision"],
            )
            message = {"role": "user", "content": content}
            self.messages.append(message)
            answer = self._request()
        except Exception:
            if message is not None and self.messages and self.messages[-1] is message:
                self.messages.pop()
            if prepared_image is not None:
                self._remove_temp_image(prepared_image)
            raise

        self.messages.append({"role": "assistant", "content": answer})
        return answer

    def clear(self) -> None:
        self.messages.clear()
        for image_path in self.temp_images:
            self._remove_temp_image(image_path)
        self.temp_images.clear()

    def close(self) -> None:
        self.clear()

    def _request(self) -> str:
        body = build_openai_request(self.config, self.messages)
        request = urllib.request.Request(
            openai_chat_url(self.config["base_url"]),
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                **(
                    {"Authorization": f"Bearer {self.config['api_key']}"}
                    if self.config["api_key"]
                    else {}
                ),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"供应商 HTTP {error.code}：{detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"供应商连接失败：{error.reason}") from error
        except TimeoutError as error:
            raise RuntimeError("供应商请求超时（300 秒）") from error

        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("供应商返回格式不完整，缺少 choices[0].message.content") from error
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            text_parts = [
                str(part["text"])
                for part in content
                if isinstance(part, dict) and part.get("text")
            ]
            if text_parts:
                return "".join(text_parts).strip()
        raise RuntimeError("供应商返回的 content 不是可识别文本")

    def _remove_temp_image(self, image_path: Path) -> None:
        try:
            image_path.unlink(missing_ok=True)
        except OSError:
            pass


def create_provider(config: dict[str, Any]):
    """根据统一配置创建具体供应商会话。"""
    if config["provider"] == "zdtaichu":
        return ZDTaichuSession(
            Path(config["model_path"]),
            config["max_tokens"],
        )
    if config["provider"] == "openai-compatible":
        return OpenAICompatibleSession(config)
    raise ValueError(f"不支持的模型供应商：{config['provider']}")


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-path",
        default=os.environ.get("ZDTAICHU_MODEL_PATH", DEFAULT_MODEL_PATH),
    )
    parser.add_argument("--max-new-tokens", type=int, default=128)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    defaults = {
        "modelPath": args.model_path,
        "maxTokens": args.max_new_tokens,
    }
    provider = None
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                request = json.loads(line)
                command = request.get("cmd")
                if command == "start":
                    if provider is not None:
                        provider.close()
                    raw_config = defaults.copy()
                    raw_config.update(request.get("config") or {})
                    config = normalize_provider_config(raw_config)
                    provider = create_provider(config)
                    emit(
                        {
                            "ok": True,
                            "data": {
                                "event": "ready",
                                "provider": config["provider"],
                                "model": config["model"],
                            },
                        }
                    )
                elif command == "chat":
                    if provider is None:
                        raise RuntimeError("模型供应商尚未启动")
                    answer = provider.chat(
                        request.get("prompt", ""),
                        request.get("imagePath") or request.get("image_path"),
                    )
                    emit({"ok": True, "data": {"answer": answer}})
                elif command == "clear":
                    if provider is None:
                        raise RuntimeError("模型供应商尚未启动")
                    provider.clear()
                    emit({"ok": True, "data": None})
                elif command == "stop":
                    emit({"ok": True, "data": None})
                    break
                else:
                    emit({"ok": False, "error": f"未知命令：{command}"})
            except Exception as error:
                emit({"ok": False, "error": str(error)})
    finally:
        if provider is not None:
            provider.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
