import { useState, useRef, useEffect, useCallback } from "react";

export type MarqueeRect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
};

type ContainerRef = React.RefObject<HTMLElement | null> | React.MutableRefObject<HTMLElement | null>;

interface UseSelectionOptions {
  containerRef?: ContainerRef;
}

export function useSelection(options?: UseSelectionOptions | ContainerRef) {
  const containerRef = options && ("current" in options ? options : options.containerRef);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const itemsRef = useRef<Map<string, HTMLElement>>(new Map());
  const initialSelection = useRef<Set<string>>(new Set());
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const startScroll = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const animFrameId = useRef<number | null>(null);
  const activeContainer = useRef<HTMLElement | null>(null);

  function registerItem(id: string, el: HTMLElement | null) {
    if (el) itemsRef.current.set(id, el);
    else itemsRef.current.delete(id);
  }

  const getScroll = useCallback((container: HTMLElement | null) => {
    const scrollTop = (container ? container.scrollTop : 0) + (window.scrollY || window.pageYOffset || 0);
    const scrollLeft = (container ? container.scrollLeft : 0) + (window.scrollX || window.pageXOffset || 0);
    return { x: scrollLeft, y: scrollTop };
  }, []);

  const updateSelectionAndMarquee = useCallback((clientX: number, clientY: number) => {
    if (!startPoint.current) return;
    const container = activeContainer.current;
    const currentScroll = getScroll(container);

    const deltaX = currentScroll.x - startScroll.current.x;
    const deltaY = currentScroll.y - startScroll.current.y;

    // Viewport position of the start point, shifted by scroll delta so it stays anchored to content
    const originX = startPoint.current.x - deltaX;
    const originY = startPoint.current.y - deltaY;

    // The full content selection bounding box in viewport coordinates
    const selRect = {
      left: Math.min(originX, clientX),
      right: Math.max(originX, clientX),
      top: Math.min(originY, clientY),
      bottom: Math.max(originY, clientY),
    };

    // Visual marquee box: clamp to container boundaries so it doesn't bleed over headers/sidebars
    let visualLeft = selRect.left;
    let visualRight = selRect.right;
    let visualTop = selRect.top;
    let visualBottom = selRect.bottom;

    if (container) {
      const cRect = container.getBoundingClientRect();
      visualLeft = Math.max(cRect.left, selRect.left);
      visualRight = Math.min(cRect.right, selRect.right);
      visualTop = Math.max(cRect.top, selRect.top);
      visualBottom = Math.min(cRect.bottom, selRect.bottom);
    }

    const dist = Math.hypot(clientX - startPoint.current.x, clientY - startPoint.current.y);
    if (dist > 3 || Math.abs(deltaY) > 3 || Math.abs(deltaX) > 3) {
      const width = Math.max(0, visualRight - visualLeft);
      const height = Math.max(0, visualBottom - visualTop);
      setMarquee({
        x1: visualLeft,
        y1: visualTop,
        x2: visualRight,
        y2: visualBottom,
        width,
        height,
      });
    }

    // Intersect test: use selRect (unclamped) so items scrolled past viewport remain selected
    const nextSelected = new Set(initialSelection.current);
    for (const [id, el] of itemsRef.current.entries()) {
      const r = el.getBoundingClientRect();
      const intersect = !(
        r.left > selRect.right ||
        r.right < selRect.left ||
        r.top > selRect.bottom ||
        r.bottom < selRect.top
      );
      if (intersect) {
        nextSelected.add(id);
      }
    }
    setSelectedIds(nextSelected);
  }, [getScroll]);

  // Smooth auto-scroll when dragging near container or viewport edges
  const autoScrollStep = useCallback(() => {
    if (!startPoint.current || !currentPointer.current) {
      animFrameId.current = null;
      return;
    }

    const container = activeContainer.current;
    const { clientX, clientY } = currentPointer.current;

    const rect = container
      ? container.getBoundingClientRect()
      : {
          top: 0,
          bottom: window.innerHeight,
          left: 0,
          right: window.innerWidth,
        };

    const EDGE_THRESHOLD = 50;
    const MAX_SPEED = 20;

    let speedY = 0;
    if (clientY > rect.bottom - EDGE_THRESHOLD) {
      const distance = clientY - (rect.bottom - EDGE_THRESHOLD);
      const intensity = Math.min(2, Math.max(0.1, distance / EDGE_THRESHOLD));
      speedY = intensity * MAX_SPEED;
    } else if (clientY < rect.top + EDGE_THRESHOLD) {
      const distance = (rect.top + EDGE_THRESHOLD) - clientY;
      const intensity = Math.min(2, Math.max(0.1, distance / EDGE_THRESHOLD));
      speedY = -intensity * MAX_SPEED;
    }

    let speedX = 0;
    if (container && container.scrollWidth > container.clientWidth) {
      if (clientX > rect.right - EDGE_THRESHOLD) {
        const distance = clientX - (rect.right - EDGE_THRESHOLD);
        speedX = Math.min(2, Math.max(0.1, distance / EDGE_THRESHOLD)) * MAX_SPEED;
      } else if (clientX < rect.left + EDGE_THRESHOLD) {
        const distance = (rect.left + EDGE_THRESHOLD) - clientX;
        speedX = -Math.min(2, Math.max(0.1, distance / EDGE_THRESHOLD)) * MAX_SPEED;
      }
    }

    if (speedY !== 0 || speedX !== 0) {
      if (container) {
        if (speedY !== 0) container.scrollTop += speedY;
        if (speedX !== 0) container.scrollLeft += speedX;
      } else {
        window.scrollBy(speedX, speedY);
      }
      updateSelectionAndMarquee(clientX, clientY);
      animFrameId.current = requestAnimationFrame(autoScrollStep);
    } else {
      animFrameId.current = null;
    }
  }, [updateSelectionAndMarquee]);

  function handlePointerDown(e: React.PointerEvent) {
    // Disable marquee selection box on mobile touch devices (touch scrolls naturally)
    if (e.pointerType === "touch") return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".selectable-item")) return;
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;

    const resolved = (containerRef && containerRef.current)
      ? containerRef.current
      : (e.currentTarget as HTMLElement) || null;
    activeContainer.current = resolved;

    const currentScroll = getScroll(resolved);
    startPoint.current = { x: e.clientX, y: e.clientY };
    startScroll.current = currentScroll;
    currentPointer.current = { clientX: e.clientX, clientY: e.clientY };
    setIsDragging(true);

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelectedIds(new Set());
      initialSelection.current = new Set();
    } else {
      initialSelection.current = new Set(selectedIds);
    }
  }

  useEffect(() => {
    if (!isDragging) return;

    function handlePointerMove(e: PointerEvent) {
      currentPointer.current = { clientX: e.clientX, clientY: e.clientY };
      updateSelectionAndMarquee(e.clientX, e.clientY);

      // Start auto-scroll loop if cursor is near edges
      if (!animFrameId.current) {
        animFrameId.current = requestAnimationFrame(autoScrollStep);
      }
    }

    function handlePointerUp() {
      setIsDragging(false);
      startPoint.current = null;
      currentPointer.current = null;
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
      setMarquee(null);
    }

    function handleScroll() {
      if (currentPointer.current) {
        updateSelectionAndMarquee(currentPointer.current.clientX, currentPointer.current.clientY);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    const container = activeContainer.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (container) {
        container.removeEventListener("scroll", handleScroll);
      }
      window.removeEventListener("scroll", handleScroll);
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
    };
  }, [isDragging, autoScrollStep, updateSelectionAndMarquee]);

  function handleItemClick(e: React.MouseEvent, id: string) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
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
    handleItemClick,
  };
}
