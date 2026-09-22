import { useEffect, useRef } from "react";

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

export default function GlobalContextMenu({ menu, onClose }: { menu: ContextMenuState | null, onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const MENU_WIDTH = 160;
  const MENU_ITEM_HEIGHT = 36;
  const menuHeight = menu.actions.length * MENU_ITEM_HEIGHT + 12;

  // Keep menu within viewport bounds
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - menuHeight - 8));

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-transparent select-none"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={ref}
        style={{ left: x, top: y, width: MENU_WIDTH }}
        className="fixed w-[160px] bg-surface2 border border-line rounded-lg shadow-2xl z-50 text-xs sm:text-sm py-1 overflow-hidden"
        onContextMenu={(e) => e.preventDefault()}
      >
        {menu.actions.map((a, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              a.onClick();
            }}
            className={`w-full text-left px-3.5 py-2 hover:bg-surface transition-colors flex items-center justify-between text-xs sm:text-sm ${
              a.danger ? "text-danger hover:bg-danger/10" : "text-paper"
            }`}
          >
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
