import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Clipboard,
  Copy,
  Info,
  RotateCw,
  type LucideIcon,
} from "lucide-react";

export interface ContextMenuItem {
  id?: string;
  label?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
}

const DEFAULT_ITEMS: ContextMenuItem[] = [
  { id: "refresh", label: "刷新", icon: RotateCw, onClick: () => console.log("refresh") },
  { id: "copy", label: "复制", icon: Copy, onClick: () => console.log("copy") },
  { id: "paste", label: "粘贴", icon: Clipboard, onClick: () => console.log("paste") },
  { divider: true },
  { id: "about", label: "关于", icon: Info, onClick: () => console.log("about") },
];

const MENU_WIDTH_ESTIMATE = 220;
const MENU_HEIGHT_ESTIMATE = 240;

export default function ContextMenu({ items }: { items?: ContextMenuItem[] }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLUListElement | null>(null);

  const resolvedItems = items ?? DEFAULT_ITEMS;

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      let x = e.clientX;
      let y = e.clientY;
      if (x + MENU_WIDTH_ESTIMATE > window.innerWidth) {
        x = Math.max(0, window.innerWidth - MENU_WIDTH_ESTIMATE);
      }
      if (y + MENU_HEIGHT_ESTIMATE > window.innerHeight) {
        y = Math.max(0, window.innerHeight - MENU_HEIGHT_ESTIMATE);
      }
      setPos({ x, y });
      setVisible(true);
    };

    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const close = () => setVisible(false);

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("click", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("click", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.ul
          ref={menuRef}
          className="ctx-menu"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12 }}
        >
          {resolvedItems.map((it, i) => {
            if (it.divider) {
              return <li key={i} className="ctx-menu__divider" />;
            }

            const Icon = it.icon;

            return (
              <li key={it.id ?? i}>
                <button
                  type="button"
                  className="ctx-menu__item"
                  disabled={it.disabled}
                  onClick={() => {
                    it.onClick?.();
                    setVisible(false);
                  }}
                >
                  {Icon && <Icon className="ctx-menu__icon" />}
                  <span>{it.label}</span>
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}
