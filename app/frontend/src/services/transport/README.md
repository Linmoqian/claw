# 传输适配

`websocket.ts` 在浏览器预览中使用浏览器 WebSocket；桌面端由 `desktopWebsocket.ts` 调用 Rust 的 `websocket_*` 命令和 Channel。两种实现共用 `Transport`，连接重试、心跳与协议处理留在上层 `ConnectionManager`。桌面传输不直接访问浏览器网络对象。
