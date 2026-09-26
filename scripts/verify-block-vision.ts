// 验证 OpenCV 初始化不会陷入 thenable 循环，并识别合成图像。Created on 2026-09-27
// @author: https://github.com/Linmoqian
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectColorFromCanvas, loadOpenCv } from "../src/blockly/vision/vision";

async function verifyVision(): Promise<void> {
  const [first, second] = await Promise.all([loadOpenCv(), loadOpenCv()]);
  assert.equal(first.cv, second.cv, "并发请求必须复用初始化后的模块");
  assert.equal(Object.hasOwn(first, "then"), false, "异步返回值不能暴露库的 thenable");
  const width = 640;
  const height = 480;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = x >= 210 && x < 340 && y >= 170 && y < 300;
      const blue = x >= 430 && x < 520 && y >= 290 && y < 380;
      const offset = (y * width + x) * 4;
      data.set(red ? [216, 31, 42, 255] : blue ? [34, 88, 200, 255]
        : [231, 233, 238, 255], offset);
    }
  }
  const canvas = {
    width, height,
    getContext: () => ({ getImageData: () => ({ width, height, data }) }),
  } as unknown as HTMLCanvasElement;
  const red = await detectColorFromCanvas(canvas, "RED");
  const blue = await detectColorFromCanvas(canvas, "BLUE");
  const green = await detectColorFromCanvas(canvas, "GREEN");
  assert.ok(red && red.area > 15000);
  assert.deepEqual([red.centerX, red.centerY], [275, 235]);
  assert.ok(blue && blue.area > 7000);
  assert.deepEqual([blue.centerX, blue.centerY], [475, 335]);
  assert.equal(green, null);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  console.log("verify-block-vision: ok");
}

if (process.argv.includes("--opencv-child")) {
  await verifyVision();
} else {
  // 微任务死循环会阻塞内部定时器，必须由外部进程限制验证时长。
  const child = spawnSync(process.execPath, [
    ...process.execArgv, fileURLToPath(import.meta.url), "--opencv-child",
  ], { encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 });
  assert.equal(child.error, undefined, "OpenCV 验证进程超时或启动失败");
  assert.equal(child.status, 0, child.stderr || "OpenCV 验证失败");
  process.stdout.write(child.stdout);
}
