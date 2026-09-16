import { useState, useRef, useEffect } from "react";

export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);
  
  const itemsRef = useRef<Map<string, HTMLElement>>(new Map());
  const initialSelection = useRef<Set<string>>(new Set());
  
  function registerItem(id: string, el: HTMLElement | null) {
    if (el) itemsRef.current.set(id, el);
    else itemsRef.current.delete(id);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.selectable-item')) return;
    
    setMarquee({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
    
    if (!e.ctrlKey && !e.metaKey) {
      setSelectedIds(new Set());
      initialSelection.current = new Set();
    } else {
      initialSelection.current = new Set(selectedIds);
    }
  }

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      if (!marquee) return;
      setMarquee(m => m ? { ...m, x2: e.clientX, y2: e.clientY } : null);
      
      const rect = {
        left: Math.min(marquee.x1, e.clientX),
        right: Math.max(marquee.x1, e.clientX),
        top: Math.min(marquee.y1, e.clientY),
        bottom: Math.max(marquee.y1, e.clientY),
      };
      
      const nextSelected = new Set(initialSelection.current);
      for (const [id, el] of itemsRef.current.entries()) {
        const r = el.getBoundingClientRect();
        const intersect = !(r.left > rect.right || r.right < rect.left || r.top > rect.bottom || r.bottom < rect.top);
        if (intersect) {
          nextSelected.add(id);
        }
      }
      setSelectedIds(nextSelected);
    }
    
    function handlePointerUp() {
      setMarquee(null);
    }
    
    if (marquee) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [marquee]);

  function handleItemClick(e: React.MouseEvent, id: string) {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      e.preventDefault();
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
      return true; // handled
    }
    return false; // let normal click happen
  }

  return {
    selectedIds,
    setSelectedIds,
    marquee,
    registerItem,
    handlePointerDown,
    handleItemClick
  };
}
