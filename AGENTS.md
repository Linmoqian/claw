# Repository Guidelines

静态验证，不构建
使用codex内部的浏览器进行截图验证

## Project Structure & Module Organization

The desktop workbench pairs a React frontend with a Tauri backend. Frontend code lives in `src/`: pages in `src/pages/`, reusable UI in `src/components/`, Three.js scene code in `src/three/`, Zustand stores in `src/stores/`, and domain logic in `src/core/`, `src/robot/`, `src/services/`, and `src/command/`. Static robot models and application assets are in `public/`. Rust/Tauri code, capabilities, and the Python servo bridge are under `src-tauri/`. Protocol requirements are documented in `docs/development/protocol-v2.md`; local mock and verification utilities live in `mock/` and `scripts/`.

## Build, Test, and Development Commands

- `npm install` installs frontend and Tauri CLI dependencies.
- `npm run dev` starts the Vite browser preview (port 1421); Tauri APIs are guarded for browser use.
- `npm run tauri dev` runs the desktop application with its Rust backend.
- `npm run build` type-checks with `tsc` and creates a production frontend build.
- `npm run lint` runs ESLint across the repository.
- `npm run format` applies Prettier; do not run it over unrelated dirty files.
- `npx tsx scripts/verify-protocol.ts` and `npx tsx scripts/verify-collision.ts` validate the corresponding domain rules when those areas change.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, semicolons, and the existing Prettier configuration. Name React components and types in `PascalCase`; use `camelCase` for functions, variables, and store fields. Keep one component per matching `PascalCase.tsx` file and colocate its CSS when the existing pattern does so. Follow ESLint's recommended TypeScript and React Hooks rules.

Wire payloads use SI units only: metres, radians, seconds, and their documented derivatives. Preserve the v2 required fields and strictly increasing per-source `sequence` values. Keep UI-only unit conversions at the Studio/Bridge boundary.

## Testing Guidelines

There is no automated test runner yet. Run `npm run lint` and `npm run build` for every code change, plus the relevant script validation above. Add focused tests or verification scripts for protocol, kinematics, collision, or command-arbitration changes; name them after the behavior they verify.

## Commit & Pull Request Guidelines

Use concise Chinese Conventional Commit subjects, such as `feat(protocol): 完成 M8 回执处理` or `fix(bridge): 修复串口重连`. Keep commits narrow and exclude `dist/`, `src-tauri/target/`, credentials, and generated artifacts. PRs should state the affected subsystem, behavior change, validation commands run, and any hardware or safety implications. Link relevant issues; include screenshots only for user-visible UI changes.
