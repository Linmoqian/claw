import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { useDevice } from "../store/DeviceContext";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import "./TitleBar.css";

type UnlistenFn = () => void;

export default function TitleBar() {
  const [maximized, setMaximized] = useState<boolean>(false);
  const { connected, deviceId } = useDevice();
  // 浏览器预览（非 Tauri 运行时）下优雅降级，避免 getCurrentWindow 崩溃
  const appWindow = isTauri() ? getCurrentWindow() : null;

  useEffect(() => {
    if (!appWindow) return;
    let active = true;
    let unlisten: UnlistenFn | null = null;

    appWindow
      .isMaximized()
      .then((value) => {
        if (active) {
          setMaximized(value);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to read maximized state:", error);
      });

    appWindow
      .onResized(() => {
        appWindow
          .isMaximized()
          .then((value) => {
            if (active) {
              setMaximized(value);
            }
          })
          .catch((error: unknown) => {
            console.error("Failed to read maximized state on resize:", error);
          });
      })
      .then((fn: UnlistenFn) => {
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to attach onResized listener:", error);
      });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appWindow]);

  const handleMinimize = (): void => {
    appWindow?.minimize().catch((error: unknown) => {
      console.error("Failed to minimize window:", error);
    });
  };

  const handleToggleMaximize = (): void => {
    appWindow?.toggleMaximize().catch((error: unknown) => {
      console.error("Failed to toggle maximize:", error);
    });
  };

  const handleClose = (): void => {
    appWindow?.close().catch((error: unknown) => {
      console.error("Failed to close window:", error);
    });
  };

  return (
    <header className="titlebar">
      <div className="titlebar__drag" data-tauri-drag-region>
        <span className="titlebar__title">虾烤工作台</span>
        <span className="titlebar__divider" />
        <span className="titlebar__model">ROBOT WORKBENCH · SO-100 配置</span>
        <span className={`titlebar__status ${connected ? "is-online" : ""}`}>
          <i />
          {connected ? (deviceId ?? "控制器在线") : "离线工作台"}
        </span>
      </div>
      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__btn titlebar__btn--min"
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <Minus />
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--max"
          onClick={handleToggleMaximize}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <Copy /> : <Square />}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          onClick={handleClose}
          aria-label="Close"
        >
          <X />
        </button>
      </div>
    </header>
  );
}
