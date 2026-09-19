"""ZDTaichu Python 桥的纯逻辑测试。"""

# Created on 2026-09-16; updated on 2026-09-16
# @author:  https://github.com/Linmoqian

import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image

from zdtaichu_bridge import (
    build_openai_request,
    build_openai_user_content,
    build_user_message,
    normalize_provider_config,
    OpenAICompatibleSession,
    prepare_image,
    provider_names,
)


class ZDTaichuBridgeTest(unittest.TestCase):
    def test_build_user_message_supports_text_and_optional_image(self):
        message = build_user_message("描述图片", Path(r"C:\photo.png"))

        self.assertEqual(message["role"], "user")
        self.assertEqual(
            message["content"],
            [
                {"type": "image", "image": r"C:\photo.png"},
                {"type": "text", "text": "描述图片"},
            ],
        )

    def test_prepare_image_converts_rgb_and_limits_longest_edge(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.png"
            output_dir = Path(temp_dir) / "prepared"
            Image.new("RGBA", (1200, 800), (12, 34, 56, 255)).save(source)

            prepared = prepare_image(source, output_dir)

            with Image.open(prepared) as image:
                self.assertEqual(image.mode, "RGB")
                self.assertLessEqual(max(image.size), 512)
                self.assertEqual(image.size, (512, 341))

    def test_provider_registry_and_openai_config_are_normalized(self):
        self.assertEqual(
            set(provider_names()),
            {"zdtaichu", "openai-compatible"},
        )
        config = normalize_provider_config(
            {
                "provider": "openai-compatible",
                "baseUrl": "http://127.0.0.1:1234/v1/",
                "model": "qwen2.5-vl",
                "supportsVision": True,
                "maxTokens": 64,
            }
        )

        self.assertEqual(config["base_url"], "http://127.0.0.1:1234/v1")
        self.assertEqual(config["model"], "qwen2.5-vl")
        self.assertTrue(config["supports_vision"])
        self.assertEqual(config["max_tokens"], 64)

        request = build_openai_request(
            config,
            [{"role": "user", "content": "hello"}],
        )
        self.assertEqual(request["model"], "qwen2.5-vl")
        self.assertEqual(request["max_tokens"], 64)
        self.assertNotIn("api_key", request)

    def test_openai_provider_rejects_image_when_vision_is_disabled(self):
        with self.assertRaisesRegex(ValueError, "不支持图片"):
            build_openai_user_content(
                "描述图片",
                "data:image/png;base64,AAAA",
                supports_vision=False,
            )

    def test_openai_compatible_session_round_trips_with_local_http_server(self):
        received: list[dict] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
                length = int(self.headers["Content-Length"])
                received.append(json.loads(self.rfile.read(length)))
                payload = {"choices": [{"message": {"content": "mock answer"}}]}
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, format, *args):  # noqa: A003 - stdlib API
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            config = normalize_provider_config(
                {
                    "provider": "openai-compatible",
                    "baseUrl": f"http://127.0.0.1:{server.server_port}/v1",
                    "model": "mock-model",
                }
            )
            session = OpenAICompatibleSession(config)
            try:
                self.assertEqual(session.chat("hello", None), "mock answer")
            finally:
                session.close()
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

        self.assertEqual(received[0]["model"], "mock-model")
        self.assertEqual(received[0]["messages"][0]["content"], "hello")


if __name__ == "__main__":
    unittest.main()
