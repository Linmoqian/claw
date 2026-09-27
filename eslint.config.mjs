import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// 配置位于仓库根目录，以便同时检查 app/ 与 tools/；依赖由 app/ 安装。
const requireFromApp = createRequire(new URL("./app/package.json", import.meta.url));
const fromApp = async (name) =>
  (await import(pathToFileURL(requireFromApp.resolve(name)).href)).default;
const [eslint, globals, reactHooks, reactRefresh, tseslint] = await Promise.all([
  fromApp("@eslint/js"),
  fromApp("globals"),
  fromApp("eslint-plugin-react-hooks"),
  fromApp("eslint-plugin-react-refresh"),
  fromApp("typescript-eslint"),
]);

export default tseslint.config(
  { ignores: ["app/dist", "app/src-tauri/target", "**/node_modules"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      "react-hooks/refs": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Node 脚本（mock 服务器/验证脚本）：用 Node 全局
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
);
