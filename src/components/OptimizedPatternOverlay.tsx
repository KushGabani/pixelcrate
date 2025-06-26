import React, { useEffect, useRef } from "react";
import { m as motion, AnimatePresence } from "framer-motion";
import { patternOverlayBatcher } from "@/utils/domBatcher";
import { useReducedMotion, createSlideVariants } from "@/lib/motion";

interface OptimizedPatternOverlayProps {
  imageId: string;
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Optimized pattern overlay component that uses batched DOM updates
 * to minimize reflows when showing/hiding multiple overlays
 */
export const OptimizedPatternOverlay: React.FC<
  OptimizedPatternOverlayProps
> = ({
  imageId,
  isVisible,
  children,
  className = "absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent",
  style = {
    bottom: "-2px",
    pointerEvents: "none",
  },
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const overlayId = `pattern-tags-${imageId}`;

  // Use batched DOM updates for better performance
  useEffect(() => {
    if (elementRef.current) {
      const operation = isVisible ? "show" : "hide";
      patternOverlayBatcher.queueOperation(
        elementRef.current,
        operation,
        overlayId,
      );
    }
  }, [isVisible, overlayId]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={elementRef}
          id={overlayId}
          className={className}
          {...createSlideVariants(useReducedMotion(), "up", 10)}
          style={style}
        >
          <div className="pointer-events-auto">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OptimizedPatternOverlay;
