/**
 * DOM Batcher utility for batching DOM updates to minimize reflows
 * Specifically designed for pattern overlay show/hide operations
 */

type DOMOperation = {
  element: HTMLElement;
  operation: 'show' | 'hide';
  id: string;
};

class DOMBatcher {
  private pendingOperations = new Map<string, DOMOperation>();
  private batchTimeout: NodeJS.Timeout | null = null;
  private animationFrame: number | null = null;

  /**
   * Queue a DOM operation to be batched
   */
  queueOperation(element: HTMLElement, operation: 'show' | 'hide', id: string) {
    // Store the operation, overwriting any previous operation for the same element
    this.pendingOperations.set(id, { element, operation, id });
    
    // Schedule batch execution if not already scheduled
    if (!this.batchTimeout) {
      this.scheduleBatch();
    }
  }

  /**
   * Schedule batch execution with debouncing and RAF
   */
  private scheduleBatch() {
    // Clear any existing timeout
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    // Debounce for 100ms, then use RAF for optimal timing
    this.batchTimeout = setTimeout(() => {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }

      this.animationFrame = requestAnimationFrame(() => {
        this.executeBatch();
      });
    }, 100);
  }

  /**
   * Execute all pending DOM operations in a single batch
   */
  private executeBatch() {
    if (this.pendingOperations.size === 0) {
      return;
    }

    // Group operations by type for more efficient DOM updates
    const showOperations: DOMOperation[] = [];
    const hideOperations: DOMOperation[] = [];

    for (const operation of this.pendingOperations.values()) {
      if (operation.operation === 'show') {
        showOperations.push(operation);
      } else {
        hideOperations.push(operation);
      }
    }

    // Batch DOM reads and writes separately to minimize layout thrashing
    this.batchDOMOperations(hideOperations, showOperations);

    // Clear pending operations
    this.pendingOperations.clear();
    this.batchTimeout = null;
    this.animationFrame = null;
  }

  /**
   * Execute DOM operations in an optimized order to minimize reflows
   */
  private batchDOMOperations(hideOps: DOMOperation[], showOps: DOMOperation[]) {
    // First, hide elements (removes from layout)
    hideOps.forEach(({ element }) => {
      element.style.opacity = '0';
      element.style.pointerEvents = 'none';
      // Use transform instead of display for better performance
      element.style.transform = 'translateY(10px)';
    });

    // Then, show elements (adds to layout)
    showOps.forEach(({ element }) => {
      element.style.opacity = '1';
      element.style.pointerEvents = 'auto';
      element.style.transform = 'translateY(0)';
    });
  }

  /**
   * Clear all pending operations (useful for cleanup)
   */
  clear() {
    this.pendingOperations.clear();
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}

// Singleton instance for pattern overlay operations
export const patternOverlayBatcher = new DOMBatcher();

/**
 * Helper function to batch pattern overlay visibility changes
 */
export function batchPatternOverlayUpdate(
  elementId: string, 
  operation: 'show' | 'hide'
) {
  const element = document.getElementById(elementId);
  if (element) {
    patternOverlayBatcher.queueOperation(element, operation, elementId);
  }
}

/**
 * Hook for managing batched pattern overlay updates
 */
export function useBatchedPatternOverlays() {
  const showPatternOverlay = (imageId: string) => {
    batchPatternOverlayUpdate(`pattern-tags-${imageId}`, 'show');
  };

  const hidePatternOverlay = (imageId: string) => {
    batchPatternOverlayUpdate(`pattern-tags-${imageId}`, 'hide');
  };

  const clearAllPendingUpdates = () => {
    patternOverlayBatcher.clear();
  };

  return {
    showPatternOverlay,
    hidePatternOverlay,
    clearAllPendingUpdates,
  };
}
