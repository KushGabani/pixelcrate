import { useEffect, useRef, useState, useCallback } from 'react';
import { ImageItem } from './useImageStore';
import { imageDecoderService, DecodedImageResult } from '../services/imageDecoderService';

/**
 * Optimized Image Preloader Hook with Intelligent Lazy Loading
 * 
 * Key Features:
 * - Throttled preloading with concurrency limits (max 4 concurrent requests)
 * - Scroll direction awareness for predictive loading
 * - Viewport distance-based prioritization
 * - Multiple IntersectionObserver thresholds for granular control
 * - Conservative initial loading (only critical images)
 * - Reduced aggressive eager loading
 * 
 * Optimizations:
 * - Reduced maxConcurrent from 50 to 4 for better performance
 * - Changed image loading from 'eager' to 'lazy'
 * - Changed fetchpriority from 'high' to 'low'
 * - Added 100ms throttle delay for batch processing
 * - Implemented scroll direction tracking with 150ms idle timeout
 * - Added sophisticated priority calculation based on viewport position
 * - Conservative preloadDistance (3-5 items instead of aggressive preloading)
 */

/**
 * LRU Cache implementation for managing memory usage
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (mark as recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing key (move to end)
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const removedValue = this.cache.get(firstKey);
        this.cache.delete(firstKey);
        
        // Clean up HTMLImageElement resources if applicable
        if (removedValue instanceof HTMLImageElement) {
          removedValue.src = '';
          removedValue.srcset = '';
        }
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const value = this.cache.get(key);
    if (value instanceof HTMLImageElement) {
      // Clean up HTMLImageElement resources
      value.src = '';
      value.srcset = '';
    }
    return this.cache.delete(key);
  }

  clear(): void {
    // Clean up all HTMLImageElement resources
    for (const [, value] of this.cache) {
      if (value instanceof HTMLImageElement) {
        value.src = '';
        value.srcset = '';
      }
    }
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  // Get memory usage estimate in MB
  getMemoryUsage(): number {
    let totalSize = 0;
    for (const [key, value] of this.cache) {
      // Estimate key size (assuming string keys)
      totalSize += new Blob([String(key)]).size;
      
      // Estimate value size
      if (value instanceof HTMLImageElement) {
        // Rough estimation: width * height * 4 bytes (RGBA) for decoded image
        totalSize += (value.naturalWidth || 0) * (value.naturalHeight || 0) * 4;
      } else {
        // For other objects, estimate JSON size
        totalSize += new Blob([JSON.stringify(value)]).size;
      }
    }
    return totalSize / (1024 * 1024); // Convert to MB
  }
}

// Configuration for cache sizes
const IMAGE_CACHE_MAX_SIZE = 200; // Max number of images to cache
const VIDEO_METADATA_CACHE_MAX_SIZE = 100; // Max number of video metadata entries to cache
const MAX_MEMORY_USAGE_MB = 500; // Maximum memory usage in MB before aggressive cleanup

// In-memory LRU caches for loaded images and video metadata
const imageCache = new LRUCache<string, HTMLImageElement>(IMAGE_CACHE_MAX_SIZE);
const videoCacheMetadata = new LRUCache<string, { posterLoaded: boolean; videoPreloaded: boolean }>(VIDEO_METADATA_CACHE_MAX_SIZE);

// Scroll direction tracking
let lastScrollY = 0;
let scrollDirection: 'up' | 'down' | 'idle' = 'idle';
let scrollTimeout: NodeJS.Timeout | null = null;

// Update scroll direction
const updateScrollDirection = () => {
  const currentScrollY = window.scrollY;
  if (currentScrollY > lastScrollY) {
    scrollDirection = 'down';
  } else if (currentScrollY < lastScrollY) {
    scrollDirection = 'up';
  }
  lastScrollY = currentScrollY;
  
  // Reset to idle after scroll stops
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    scrollDirection = 'idle';
  }, 150);
};

// Add scroll listener
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', updateScrollDirection, { passive: true });
}

// Throttled preload queue with concurrency limits
class ThrottledPreloadQueue {
  private queue: Array<{ url: string; priority: number; distance: number }> = [];
  private loading = new Set<string>();
  private maxConcurrent = 4; // Reduced concurrent loading for better performance
  private throttleDelay = 100; // ms between batch processing
  private lastProcessTime = 0;

  add(url: string, priority: number = 0, distance: number = 0) {
    if (this.loading.has(url) || imageCache.has(url)) return;
    
    // Remove existing entry if it exists
    this.queue = this.queue.filter(item => item.url !== url);
    
    // Add with priority and distance considerations
    this.queue.push({ url, priority, distance });
    this.sortQueue();
    
    this.processQueue();
  }

  private sortQueue() {
    this.queue.sort((a, b) => {
      // Prioritize by:
      // 1. Higher priority first
      // 2. Closer distance (lower distance value)
      // 3. Scroll direction preference (prioritize forward direction)
      const priorityDiff = b.priority - a.priority;
      if (priorityDiff !== 0) return priorityDiff;
      
      const distanceDiff = a.distance - b.distance;
      if (distanceDiff !== 0) return distanceDiff;
      
      // Consider scroll direction for tie-breaking
      if (scrollDirection === 'down') {
        return a.distance - b.distance; // Prioritize items further down
      } else if (scrollDirection === 'up') {
        return b.distance - a.distance; // Prioritize items further up
      }
      
      return 0;
    });
  }

  private async processQueue() {
    const now = Date.now();
    
    // Throttle processing
    if (now - this.lastProcessTime < this.throttleDelay) {
      setTimeout(() => this.processQueue(), this.throttleDelay);
      return;
    }
    
    if (this.loading.size >= this.maxConcurrent || this.queue.length === 0) return;

    this.lastProcessTime = now;
    const item = this.queue.shift();
    if (!item || imageCache.has(item.url)) return;

    this.loading.add(item.url);

    try {
      await this.preloadImage(item.url);
    } catch (error) {
      console.warn('Failed to preload image:', item.url, error);
    } finally {
      this.loading.delete(item.url);
      // Continue processing after a short delay
      setTimeout(() => this.processQueue(), 50);
    }
  }

private preloadImage(url: string): Promise<void> {
    return imageDecoderService.decodeImage(url)
      .then((result: DecodedImageResult) => {
        if (result.imageBitmap || result.canvas || result.fallbackImage) {
          const img = imageDecoderService.createImageFromResult(result, url);
          imageCache.set(url, img);
        }
      });
  }

  // Original preloadImage function just renamed to use the service
  private preloadImageLegacy(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Skip if already cached
      if (imageCache.has(url)) {
        resolve();
        return;
      }

      const img = new Image();
      
      // Optimized lazy loading settings
      img.loading = 'lazy';
      img.fetchpriority = 'low';
      img.decoding = 'async';
      
      img.onload = async () => {
        // Force decode the image to eliminate decode delay during rendering
        try {
          if ('decode' in img) {
            await img.decode();
          }
        } catch (decodeError) {
          // Decode failed, but image loaded - continue anyway
          console.warn('Image decode failed but loading succeeded:', decodeError);
        }
        
        imageCache.set(url, img);
        resolve();
      };
      
      img.onerror = (error) => {
        reject(error);
      };

      // Set crossOrigin for local-file:// protocol support
      img.crossOrigin = 'anonymous';
      img.src = url;
    });
  }

  clear() {
    this.queue = [];
    this.loading.clear();
  }

  // Get current queue length for debugging
  getQueueLength() {
    return this.queue.length;
  }

  // Get current loading count for debugging
  getLoadingCount() {
    return this.loading.size;
  }
}

const preloadQueue = new ThrottledPreloadQueue();

interface UseImagePreloaderOptions {
  rootMargin?: string;
  threshold?: number;
  preloadDistance?: number; // Number of items ahead to preload
}

export function useImagePreloader(
  images: ImageItem[],
  options: UseImagePreloaderOptions = {}
) {
  const {
    rootMargin = '1500px', // Much larger for masonry grids with tall images
    threshold = 0.01,
    preloadDistance = 6
  } = options;

  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [visibleImages, setVisibleImages] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRefs = useRef<Map<string, Element>>(new Map());

  // Check if image is already cached
  const isImageCached = useCallback((url: string) => {
    return imageCache.has(url);
  }, []);

  // Get cached image
  const getCachedImage = useCallback((url: string) => {
    return imageCache.get(url);
  }, []);

  // Preload images with priority
  const preloadImage = useCallback((url: string, priority: number = 0) => {
    if (!url || url.startsWith('data:')) return Promise.resolve();
    
    if (imageCache.has(url)) {
      setLoadedImages(prev => new Set(prev).add(url));
      return Promise.resolve();
    }

    preloadQueue.add(url, priority);
    return Promise.resolve();
  }, []);

  // Preload video poster
  const preloadVideoPoster = useCallback((item: ImageItem, priority: number = 0) => {
    if (item.type !== 'video' || !item.posterUrl) return Promise.resolve();

    const metadata = videoCacheMetadata.get(item.id) || { posterLoaded: false, videoPreloaded: false };
    
    if (!metadata.posterLoaded) {
      preloadQueue.add(item.posterUrl, priority);
      videoCacheMetadata.set(item.id, { ...metadata, posterLoaded: true });
    }

    return Promise.resolve();
  }, []);

  // Calculate distance from viewport center
  const calculateViewportDistance = useCallback((element: Element): number => {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportCenter = viewportHeight / 2;
    const elementCenter = rect.top + rect.height / 2;
    
    return Math.abs(elementCenter - viewportCenter);
  }, []);

  // Calculate priority based on viewport position and scroll direction
  const calculatePriority = useCallback((element: Element, baseIndex: number): number => {
    const distance = calculateViewportDistance(element);
    const rect = element.getBoundingClientRect();
    
    // Base priority from index (earlier images get higher priority)
    let priority = Math.max(0, 100 - baseIndex);
    
    // Boost priority for images closer to viewport center
    const maxDistance = window.innerHeight;
    const distanceBoost = Math.max(0, 50 - (distance / maxDistance) * 50);
    priority += distanceBoost;
    
    // Adjust based on scroll direction and position
    if (scrollDirection === 'down' && rect.top > 0) {
      // Scrolling down, prioritize images below viewport
      priority += 20;
    } else if (scrollDirection === 'up' && rect.bottom < window.innerHeight) {
      // Scrolling up, prioritize images above viewport
      priority += 20;
    } else if (scrollDirection === 'idle') {
      // Not scrolling, prioritize currently visible images
      if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
        priority += 30;
      }
    }
    
    return Math.floor(priority);
  }, [calculateViewportDistance]);

  // Setup intersection observer with multiple thresholds
  useEffect(() => {
    // Use multiple thresholds for more granular control
    const thresholds = [0, 0.1, 0.25, 0.5, 0.75, 1.0];
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const newVisibleImages = new Set(visibleImages);
        const newLoadedImages = new Set(loadedImages);
        const imageIndexMap = new Map(images.map((img, index) => [img.id, index]));

        entries.forEach((entry) => {
          const imageId = entry.target.getAttribute('data-image-id');
          if (!imageId) return;

          const imageIndex = imageIndexMap.get(imageId) ?? 0;
          const image = images.find(img => img.id === imageId);
          if (!image) return;

          if (entry.isIntersecting) {
            newVisibleImages.add(imageId);
            
            // Calculate priority based on viewport position and intersection ratio
            const element = entry.target;
            let priority = calculatePriority(element, imageIndex);
            
            // Boost priority based on intersection ratio (more visible = higher priority)
            priority += Math.floor(entry.intersectionRatio * 25);
            
            // Calculate distance from viewport for queue sorting
            const distance = calculateViewportDistance(element);
            
            // Prioritize loading for visible images
            if (image.type === 'video') {
              preloadQueue.add(image.posterUrl || '', priority, distance);
            } else {
              preloadQueue.add(image.url, priority, distance);
            }

            // Mark as loaded if cached
            if (image.type === 'image' && isImageCached(image.url)) {
              newLoadedImages.add(imageId);
            } else if (image.type === 'video' && image.posterUrl && isImageCached(image.posterUrl)) {
              newLoadedImages.add(imageId);
            }
          } else {
            newVisibleImages.delete(imageId);
          }
        });

        setVisibleImages(newVisibleImages);
        setLoadedImages(newLoadedImages);
      },
      {
        rootMargin,
        threshold: thresholds
      }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [images, calculatePriority, calculateViewportDistance, isImageCached, rootMargin, visibleImages, loadedImages]);

  // Observe elements
  const observeElement = useCallback((element: Element, imageId: string) => {
    if (!observerRef.current) return;

    element.setAttribute('data-image-id', imageId);
    elementRefs.current.set(imageId, element);
    observerRef.current.observe(element);
  }, []);

  // Unobserve elements
  const unobserveElement = useCallback((imageId: string) => {
    if (!observerRef.current) return;

    const element = elementRefs.current.get(imageId);
    if (element) {
      observerRef.current.unobserve(element);
      elementRefs.current.delete(imageId);
    }
  }, []);

  // Listen for successful image loads
  useEffect(() => {
    const handleImageLoad = () => {
      // Check which images are now loaded
      const newLoadedImages = new Set<string>();
      
      images.forEach(image => {
        if (image.type === 'image' && isImageCached(image.url)) {
          newLoadedImages.add(image.id);
        } else if (image.type === 'video' && image.posterUrl && isImageCached(image.posterUrl)) {
          newLoadedImages.add(image.id);
        }
      });

      setLoadedImages(newLoadedImages);
    };

    // Check periodically for newly loaded images
    const interval = setInterval(handleImageLoad, 100);
    
    return () => clearInterval(interval);
  }, [images, isImageCached]);

  // Conservative preloading: only preload images near viewport or critical ones
  useEffect(() => {
    if (images.length === 0) return;
    
    const preloadCriticalImages = () => {
      // Only preload first few images immediately (likely to be visible first)
      const criticalCount = Math.min(preloadDistance, images.length);
      
      images.slice(0, criticalCount).forEach((image, index) => {
        // High priority for critical images
        const priority = 80 + (criticalCount - index) * 5;
        
        if (image.type === 'video') {
          preloadQueue.add(image.posterUrl || '', priority, 0);
        } else {
          preloadQueue.add(image.url, priority, 0);
        }
      });
    };

    // Delay initial preloading to avoid blocking UI
    const timer = setTimeout(preloadCriticalImages, 100);
    
    return () => clearTimeout(timer);
  }, [images, preloadDistance]);

  // Clear cache when images change significantly
  useEffect(() => {
    const currentImageUrls = new Set(images.map(img => img.url));
    
    // Remove cached images that are no longer in the list
    for (const [url] of imageCache.entries()) {
      if (!currentImageUrls.has(url)) {
        imageCache.delete(url);
      }
    }

    // Clean up video metadata
    const currentImageIds = new Set(images.map(img => img.id));
    for (const [id] of videoCacheMetadata.entries()) {
      if (!currentImageIds.has(id)) {
        videoCacheMetadata.delete(id);
      }
    }
  }, [images]);

  // Debug logging for development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const logInterval = setInterval(() => {
        const queueLength = preloadQueue.getQueueLength();
        const loadingCount = preloadQueue.getLoadingCount();
        const cachedCount = imageCache.size;
        
        if (queueLength > 0 || loadingCount > 0) {
          console.log(`[ImagePreloader] Queue: ${queueLength}, Loading: ${loadingCount}, Cached: ${cachedCount}, Scroll: ${scrollDirection}`);
        }
      }, 2000);
      
      return () => clearInterval(logInterval);
    }
  }, []);

  return {
    observeElement,
    unobserveElement,
    isImageLoaded: (imageId: string) => loadedImages.has(imageId),
    isImageVisible: (imageId: string) => visibleImages.has(imageId),
    isImageCached,
    getCachedImage,
    preloadImage,
    // Clear all caches (useful for memory management)
    clearCache: () => {
      imageCache.clear();
      videoCacheMetadata.clear();
      preloadQueue.clear();
      setLoadedImages(new Set());
      setVisibleImages(new Set());
    },
    // Debug methods for development
    getStats: () => ({
      queueLength: preloadQueue.getQueueLength(),
      loadingCount: preloadQueue.getLoadingCount(),
      cachedCount: imageCache.size,
      scrollDirection,
      visibleCount: visibleImages.size,
      loadedCount: loadedImages.size
    })
  };
}