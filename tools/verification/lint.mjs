// 检查应用与工具代码。Created on 2026-09-28
// @author: https://github.com/Linmoqian
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromApp = createRequire(resolve(workspaceRoot, "app/package.json"));
const { ESLint } = requireFromApp("eslint");
const eslint = new ESLint({
  cwd: workspaceRoot,
  overrideConfigFile: resolve(workspaceRoot, "eslint.config.mjs"),
});
const results = await eslint.lintFiles(["app", "tools"]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) process.stdout.write(output);
process.exitCode = results.some((result) => result.errorCount > 0) ? 1 : 0;
