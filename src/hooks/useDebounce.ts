import { useCallback, useRef } from 'react';

/**
 * Hook for debouncing function calls
 * @param callback The function to debounce
 * @param delay Debounce delay in milliseconds
 * @returns Debounced function
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay]
  );
}

/**
 * Hook for batching DOM updates using requestAnimationFrame
 * @param callback The function to batch
 * @returns Batched function
 */
export function useBatchedDOMUpdates<T extends (...args: any[]) => any>(
  callback: T
): T {
  const frameRef = useRef<number>();

  return useCallback(
    ((...args: Parameters<T>) => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        callback(...args);
      });
    }) as T,
    [callback]
  );
}

/**
 * Hook that combines debouncing with batched DOM updates
 * @param callback The function to debounce and batch
 * @param delay Debounce delay in milliseconds
 * @returns Debounced and batched function
 */
export function useDebouncedBatchedUpdates<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const frameRef = useRef<number>();

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
        }

        frameRef.current = requestAnimationFrame(() => {
          callback(...args);
        });
      }, delay);
    }) as T,
    [callback, delay]
  );
}

/**
 * Hook for debouncing scroll events with requestAnimationFrame batching
 * @param callback The scroll handler function
 * @param delay Debounce delay in milliseconds
 * @returns Debounced scroll handler
 */
export function useDebouncedScroll(
  callback: (event: Event) => void,
  delay: number = 100
) {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const frameRef = useRef<number>();
  const lastScrollTime = useRef<number>(0);

  return useCallback(
    (event: Event) => {
      const now = performance.now();
      
      // Throttle rapid scroll events
      if (now - lastScrollTime.current < 16) { // ~60fps
        return;
      }
      
      lastScrollTime.current = now;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
        }

        frameRef.current = requestAnimationFrame(() => {
          callback(event);
        });
      }, delay);
    },
    [callback, delay]
  );
}
