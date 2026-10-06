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

  // Starting anchor point in content (absolute) coordinates
  const startContentPoint = useRef<{ x: number; y: number } | null>(null);
  // Pointer on screen (for auto-scroll calculation)
  const currentPointer = useRef<{ clientX: number; clientY: number } | null>(null);

  const animFrameId = useRef<number | null>(null);
  const activeContainer = useRef<HTMLElement | null>(null);

  function registerItem(id: string, el: HTMLElement | null) {
    if (el) itemsRef.current.set(id, el);
    else itemsRef.current.delete(id);
  }

  // Combined scroll position of container and window
  const getScroll = useCallback((container: HTMLElement | null) => {
    const scrollTop = (container ? container.scrollTop : 0) + (window.scrollY || window.pageYOffset || 0);
    const scrollLeft = (container ? container.scrollLeft : 0) + (window.scrollX || window.pageXOffset || 0);
    return { x: scrollLeft, y: scrollTop };
  }, []);

  const updateSelectionAndMarquee = useCallback((clientX: number, clientY: number) => {
    if (!startContentPoint.current) return;
    const container = activeContainer.current;
    const currentScroll = getScroll(container);

    // Current pointer position in absolute content coordinates
    const currentContentX = clientX + currentScroll.x;
    const currentContentY = clientY + currentScroll.y;

    // Selection box in content (absolute) coordinates - IMMUNE TO SCROLLING
    const box = {
      left: Math.min(startContentPoint.current.x, currentContentX),
      right: Math.max(startContentPoint.current.x, currentContentX),
      top: Math.min(startContentPoint.current.y, currentContentY),
      bottom: Math.max(startContentPoint.current.y, currentContentY),
    };

    // Screen coordinates for fixed visual overlay
    const screenLeft = box.left - currentScroll.x;
    const screenTop = box.top - currentScroll.y;
    const screenWidth = box.right - box.left;
    const screenHeight = box.bottom - box.top;

    // Visible container bounds on the screen
    const cRect = container ? container.getBoundingClientRect() : {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
    };

    // Clamp the visual overlay inside the visible container boundaries
    const visualLeft = Math.max(cRect.left, screenLeft);
    const visualTop = Math.max(cRect.top, screenTop);
    const visualRight = Math.min(cRect.right, screenLeft + screenWidth);
    const visualBottom = Math.min(cRect.bottom, screenTop + screenHeight);

    const visualW = Math.max(0, visualRight - visualLeft);
    const visualH = Math.max(0, visualBottom - visualTop);

    // Only render visual box when dragged at least 3px
    if (screenWidth > 3 || screenHeight > 3) {
      setMarquee({
        x1: visualLeft,
        y1: visualTop,
        x2: visualRight,
        y2: visualBottom,
        width: visualW,
        height: visualH,
      });
    }

    // Intersect test: compare item's absolute content rect against selection box.
    // An item's content coordinate is (r.top + currentScroll.y).
    // This value is 100% constant regardless of how much the list scrolls!
    const nextSelected = new Set(initialSelection.current);
    for (const [id, el] of itemsRef.current.entries()) {
      const r = el.getBoundingClientRect();
      const itemTop = r.top + currentScroll.y;
      const itemBottom = r.bottom + currentScroll.y;
      const itemLeft = r.left + currentScroll.x;
      const itemRight = r.right + currentScroll.x;

      const intersect = !(
        itemLeft > box.right ||
        itemRight < box.left ||
        itemTop > box.bottom ||
        itemBottom < box.top
      );

      if (intersect) {
        nextSelected.add(id);
      }
    }
    setSelectedIds(nextSelected);
  }, [getScroll]);

  // Smooth auto-scroll loop when pointer is near visible container / viewport edges
  const autoScrollStep = useCallback(() => {
    if (!startContentPoint.current || !currentPointer.current) {
      animFrameId.current = null;
      return;
    }

    const container = activeContainer.current;
    const { clientX, clientY } = currentPointer.current;

    const cRect = container ? container.getBoundingClientRect() : {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
    };

    // Detect visible edges within the browser window
    const visibleTop = Math.max(0, cRect.top);
    const visibleBottom = Math.min(window.innerHeight, cRect.bottom);
    const visibleLeft = Math.max(0, cRect.left);
    const visibleRight = Math.min(window.innerWidth, cRect.right);

    const EDGE_THRESHOLD = 60;
    const MAX_SPEED = 24;

    let speedY = 0;
    if (clientY > visibleBottom - EDGE_THRESHOLD) {
      const dist = clientY - (visibleBottom - EDGE_THRESHOLD);
      const intensity = Math.min(2.5, Math.max(0.2, dist / EDGE_THRESHOLD));
      speedY = intensity * MAX_SPEED;
    } else if (clientY < visibleTop + EDGE_THRESHOLD) {
      const dist = (visibleTop + EDGE_THRESHOLD) - clientY;
      const intensity = Math.min(2.5, Math.max(0.2, dist / EDGE_THRESHOLD));
      speedY = -intensity * MAX_SPEED;
    }

    let speedX = 0;
    if (clientX > visibleRight - EDGE_THRESHOLD) {
      const dist = clientX - (visibleRight - EDGE_THRESHOLD);
      speedX = Math.min(2.5, Math.max(0.2, dist / EDGE_THRESHOLD)) * MAX_SPEED;
    } else if (clientX < visibleLeft + EDGE_THRESHOLD) {
      const dist = (visibleLeft + EDGE_THRESHOLD) - clientX;
      speedX = -Math.min(2.5, Math.max(0.2, dist / EDGE_THRESHOLD)) * MAX_SPEED;
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
    // Anchor in absolute content coordinates
    startContentPoint.current = {
      x: e.clientX + currentScroll.x,
      y: e.clientY + currentScroll.y,
    };
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
      startContentPoint.current = null;
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
