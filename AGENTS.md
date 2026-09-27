# Repository Guidelines

静态验证，不构建
使用codex内部的浏览器进行截图验证

## Project Structure & Module Organization

The desktop workbench pairs a React frontend in `app/frontend/` with a Tauri backend in `app/src-tauri/`. Frontend source and static assets are under `app/frontend/src/` and `app/frontend/public/`. Protocol requirements live in `docs/development/protocol-v2.md`; local mock and verification utilities live in `tools/mock/` and `tools/verification/`.

## Build, Test, and Development Commands

- `pnpm --dir app install` installs frontend and Tauri CLI dependencies.
- `pnpm --dir app run dev` starts the Vite browser preview (port 1421); Tauri APIs are guarded for browser use.
- `pnpm --dir app run tauri dev` runs the desktop application with its Rust backend.
- `pnpm --dir app exec tsc --noEmit` type-checks the frontend without producing a build.
- `pnpm --dir app run lint` runs ESLint across the application and tools.
- `pnpm --dir app run format` applies Prettier; do not run it over unrelated dirty files.
- `pnpm dlx tsx tools/verification/verify-protocol.ts` and the corresponding collision script validate domain rules when those areas change.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, semicolons, and the existing Prettier configuration. Name React components and types in `PascalCase`; use `camelCase` for functions, variables, and store fields. Keep one component per matching `PascalCase.tsx` file and colocate its CSS when the existing pattern does so. Follow ESLint's recommended TypeScript and React Hooks rules.

Wire payloads use SI units only: metres, radians, seconds, and their documented derivatives. Preserve the v2 required fields and strictly increasing per-source `sequence` values. Keep UI-only unit conversions at the Studio/Bridge boundary.

## Testing Guidelines

There is no automated frontend test runner yet. Run TypeScript `--noEmit` and ESLint for code changes, plus focused verification scripts for changed domain rules. Run `cargo check` for Rust changes when authorized; do not make a production build for static validation.

## Commit & Pull Request Guidelines

Use concise Chinese Conventional Commit subjects, such as `feat(protocol): 完成 M8 回执处理` or `fix(bridge): 修复串口重连`. Keep commits narrow and exclude `dist/`, `src-tauri/target/`, credentials, and generated artifacts. PRs should state the affected subsystem, behavior change, validation commands run, and any hardware or safety implications. Link relevant issues; include screenshots only for user-visible UI changes.
