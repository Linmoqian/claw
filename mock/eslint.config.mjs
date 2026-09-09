// mock 子包的 lint 配置（flat config 与根配置合并生效）：Node 脚本环境
import globals from "globals";

export default [
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },
];