import { LazyMotion, domAnimation, domMax } from "framer-motion";
import { useEffect, useState } from "react";
import React from "react";

// Lazy motion features - load only what we need
export const lazyMotionFeatures = domAnimation;

// Custom hook to detect reduced motion preference
export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

// Optimized transition variants that respect reduced motion
export const createOptimizedTransition = (
  prefersReducedMotion: boolean,
  type: "fade" | "slide" | "scale" | "spring" = "fade"
) => {
  if (prefersReducedMotion) {
    return {
      duration: 0.01, // Near-instant for reduced motion
      ease: "linear"
    };
  }

  switch (type) {
    case "fade":
      return {
        duration: 0.2,
        ease: "easeOut"
      };
    case "slide":
      return {
        duration: 0.3,
        ease: [0.25, 0.46, 0.45, 0.94] // Custom easing curve
      };
    case "scale":
      return {
        duration: 0.25,
        ease: "easeOut"
      };
    case "spring":
      return {
        type: "tween", // Use tween instead of spring for better performance
        duration: 0.4,
        ease: [0.25, 0.46, 0.45, 0.94]
      };
    default:
      return {
        duration: 0.2,
        ease: "easeOut"
      };
  }
};

// Optimized variant creators
export const createFadeVariants = (prefersReducedMotion: boolean) => ({
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: createOptimizedTransition(prefersReducedMotion, "fade")
  },
  exit: { 
    opacity: 0,
    transition: createOptimizedTransition(prefersReducedMotion, "fade")
  }
});

export const createSlideVariants = (
  prefersReducedMotion: boolean,
  direction: "up" | "down" | "left" | "right" = "up",
  distance: number = 10
) => {
  const slideOffset = {
    up: { y: distance },
    down: { y: -distance },
    left: { x: distance },
    right: { x: -distance }
  };

  return {
    initial: { 
      opacity: 0, 
      ...slideOffset[direction]
    },
    animate: { 
      opacity: 1, 
      x: 0, 
      y: 0,
      transition: createOptimizedTransition(prefersReducedMotion, "slide")
    },
    exit: { 
      opacity: 0, 
      ...slideOffset[direction],
      transition: createOptimizedTransition(prefersReducedMotion, "slide")
    }
  };
};

export const createScaleVariants = (prefersReducedMotion: boolean) => ({
  initial: { 
    opacity: 0, 
    scale: 0.95 
  },
  animate: { 
    opacity: 1, 
    scale: 1,
    transition: createOptimizedTransition(prefersReducedMotion, "scale")
  },
  exit: { 
    opacity: 0, 
    scale: 0.95,
    transition: createOptimizedTransition(prefersReducedMotion, "scale")
  }
});

// Optimized spring animation for modal transformations
export const createModalVariants = (
  prefersReducedMotion: boolean,
  initialPosition: { width: number; height: number; x: number; y: number },
  finalPosition: { width: number; height: number; x: number; y: number }
) => {
  const transition = prefersReducedMotion 
    ? { duration: 0.01, ease: "linear" }
    : {
        type: "tween", // Use tween instead of spring
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94] // Custom cubic-bezier for smooth animation
      };

  return {
    initial: {
      width: initialPosition.width,
      height: initialPosition.height,
      x: initialPosition.x,
      y: initialPosition.y,
      borderRadius: "0.5rem",
      zIndex: 50
    },
    open: {
      width: finalPosition.width,
      height: finalPosition.height,
      x: finalPosition.x,
      y: finalPosition.y,
      borderRadius: "1rem",
      transition
    },
    exit: {
      width: initialPosition.width,
      height: initialPosition.height,
      x: initialPosition.x,
      y: initialPosition.y,
      borderRadius: "0.5rem",
      transition
    }
  };
};

// Wrapper component for LazyMotion
export const MotionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LazyMotion features={lazyMotionFeatures} strict>
    {children}
  </LazyMotion>
);
