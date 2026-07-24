import { useEffect, useState } from 'react';
import { Cat, Copy, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './TitleBar.css';

type UnlistenFn = () => void;

export default function TitleBar() {
  const [maximized, setMaximized] = useState<boolean>(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
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
        console.error('Failed to read maximized state:', error);
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
            console.error('Failed to read maximized state on resize:', error);
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
        console.error('Failed to attach onResized listener:', error);
      });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appWindow]);

  const handleMinimize = (): void => {
    appWindow.minimize().catch((error: unknown) => {
      console.error('Failed to minimize window:', error);
    });
  };

  const handleToggleMaximize = (): void => {
    appWindow.toggleMaximize().catch((error: unknown) => {
      console.error('Failed to toggle maximize:', error);
    });
  };

  const handleClose = (): void => {
    appWindow.close().catch((error: unknown) => {
      console.error('Failed to close window:', error);
    });
  };

  return (
    <header className="titlebar">
      <div className="titlebar__drag" data-tauri-drag-region>
        <Cat className="titlebar__icon" />
        <span className="titlebar__title">claw</span>
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
          aria-label={maximized ? 'Restore' : 'Maximize'}
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
