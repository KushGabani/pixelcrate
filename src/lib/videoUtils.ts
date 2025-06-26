/**
 * LRU Cache implementation for video metadata
 */
class VideoMetadataLRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  private readonly maxMemoryMB: number;

  constructor(maxSize: number, maxMemoryMB: number = 100) {
    this.maxSize = maxSize;
    this.maxMemoryMB = maxMemoryMB;
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
    } else {
      // Check if we need to evict entries
      this.evictIfNeeded();
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  // Evict entries if cache is full or memory usage is too high
  private evictIfNeeded(): void {
    // Check size limit
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }

    // Check memory usage
    const memoryUsage = this.getMemoryUsage();
    if (memoryUsage > this.maxMemoryMB) {
      // Evict oldest entries until memory is under limit
      const entriesToEvict = Math.ceil(this.cache.size * 0.2); // Evict 20% of entries
      for (let i = 0; i < entriesToEvict && this.cache.size > 0; i++) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
    }
  }

  // Get memory usage estimate in MB
  getMemoryUsage(): number {
    let totalSize = 0;
    for (const [key, value] of this.cache) {
      // Estimate key size (assuming string keys)
      totalSize += new Blob([String(key)]).size;
      
      // Estimate value size
      if (typeof value === 'object' && value !== null) {
        // For video metadata objects, estimate based on posterUrl size
        const metadata = value as any;
        if (metadata.posterUrl && typeof metadata.posterUrl === 'string') {
          // Data URLs can be very large, estimate based on length
          if (metadata.posterUrl.startsWith('data:')) {
            totalSize += metadata.posterUrl.length;
          } else {
            totalSize += 1024; // Small size for regular URLs
          }
        }
        // Add size for other properties
        totalSize += new Blob([JSON.stringify({
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration
        })]).size;
      } else {
        totalSize += new Blob([JSON.stringify(value)]).size;
      }
    }
    return totalSize / (1024 * 1024); // Convert to MB
  }

  // Get cache statistics
  getStats(): { size: number; memoryUsage: number; maxSize: number; maxMemoryMB: number } {
    return {
      size: this.cache.size,
      memoryUsage: this.getMemoryUsage(),
      maxSize: this.maxSize,
      maxMemoryMB: this.maxMemoryMB
    };
  }
}

// Video metadata cache with LRU eviction
const VIDEO_METADATA_CACHE_SIZE = 200; // Max number of video metadata entries
const VIDEO_METADATA_MEMORY_LIMIT_MB = 150; // Max memory usage for video metadata

const videoMetadataCache = new VideoMetadataLRUCache<string, {
  width: number;
  height: number;
  duration: number;
  posterUrl: string;
}>(VIDEO_METADATA_CACHE_SIZE, VIDEO_METADATA_MEMORY_LIMIT_MB);

const videoFramesCache = new VideoMetadataLRUCache<string, string[]>(100, 50); // Cache for captured frames

// Helper function to get video dimensions and generate a thumbnail
export function getVideoDimensions(videoSrc: string): Promise<{
  width: number;
  height: number;
  duration: number;
  posterUrl: string;
}> {
  return new Promise((resolve, reject) => {
    if (!videoSrc) {
      reject(new Error('Video source is empty'));
      return;
    }

    // Check cache first
    const cached = videoMetadataCache.get(videoSrc);
    if (cached) {
      resolve(cached);
      return;
    }

    const video = document.createElement('video');

    // Ensure we load the metadata
    video.preload = 'metadata';

    // Set cross-origin attributes to avoid issues
    video.crossOrigin = 'anonymous';

    // Add event handlers
    video.onloadedmetadata = () => {

      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;

      // Always generate poster from the first frame
      const seekTime = 0;

      try {
        video.currentTime = seekTime;
      } catch (err) {
        console.error('Error seeking video', err);
        // If seeking fails, try to generate poster from current frame
        generatePoster();
      }
    };

    video.onseeked = generatePoster;

    // Handle errors
    video.onerror = (e) => {
      const errorMessage = video.error?.message || 'Unknown error';
      // Only log as error if it's not the empty src attribute case
      if (video.error?.code !== 4) {
        console.error('Video loading error:', video.error);
      }
      // For empty src, provide default dimensions
      if (video.error?.code === 4) {
        resolve({
          width: 640,
          height: 360,
          duration: 0,
          posterUrl: '',
        });
      } else {
        reject(new Error(`Video error: ${errorMessage}`));
      }
    };

    function generatePoster() {
      try {
        // Create a canvas to draw the video frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640; // Fallback width if not available
        canvas.height = video.videoHeight || 360; // Fallback height if not available

        // Draw the video frame to the canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert the canvas to a data URL (JPEG for smaller size)
          const posterUrl = canvas.toDataURL('image/jpeg', 0.8);

          // Clean up
          video.removeAttribute('src'); // Use removeAttribute instead of setting to empty string
          video.load(); // Ensure the video element is properly reset

          // Create result object
          const result = {
            width: video.videoWidth || 640,
            height: video.videoHeight || 360,
            duration: video.duration || 0,
            posterUrl,
          };

          // Cache the result
          videoMetadataCache.set(videoSrc, result);

          // Resolve with the video dimensions and poster URL
          resolve(result);
        } else {
          reject(new Error('Could not get canvas context'));
        }
      } catch (err) {
        console.error('Error generating poster:', err);
        reject(err);
      }
    }

    // Set the video source and start loading
    video.src = videoSrc;
    video.load();
  });
}

/**
 * Captures frames from a video at specific percentages of the duration
 * @param videoSrc The URL or data URL of the video
 * @param percentages Array of percentages (0-1) at which to capture frames
 * @returns Promise resolving to an array of frame data URLs
 */
export function captureVideoFrames(
  videoSrc: string,
  percentages: number[] = [0.33, 0.66]
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!videoSrc) {
      reject(new Error('Video source is empty'));
      return;
    }

    // Create a cache key based on video source and percentages
    const cacheKey = `${videoSrc}:${percentages.join(',')}`;
    
    // Check cache first
    const cached = videoFramesCache.get(cacheKey);
    if (cached) {
      resolve(cached);
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    
    const frames: string[] = [];
    let percentageIndex = 0;

    video.onloadedmetadata = () => {
      // First, try to seek to the first percentage point
      if (percentages.length > 0 && video.duration) {
        try {
          // Calculate the time to seek to based on the percentage
          const seekTime = video.duration * percentages[percentageIndex];
          video.currentTime = seekTime;
        } catch (err) {
          console.error('Error seeking video', err);
          reject(err);
        }
      } else {
        reject(new Error('No percentages provided or video has no duration'));
      }
    };

    video.onseeked = () => {
      try {
        // Create a canvas to draw the video frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw the video frame to the canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Convert the canvas to a data URL (JPEG for smaller size)
          const frameUrl = canvas.toDataURL('image/jpeg', 0.9);
          frames.push(frameUrl);
          
          // Move to the next percentage if there is one
          percentageIndex++;
          if (percentageIndex < percentages.length) {
            try {
              video.currentTime = video.duration * percentages[percentageIndex];
            } catch (err) {
              console.error('Error seeking to next frame', err);
              // Even if seeking to next frame fails, we still have some frames
              cleanupAndResolve();
            }
          } else {
            // We've captured all frames, clean up and resolve
            cleanupAndResolve();
          }
        } else {
          reject(new Error('Could not get canvas context'));
        }
      } catch (err) {
        console.error('Error capturing frame:', err);
        reject(err);
      }
    };

    // Handle errors
    video.onerror = (e) => {
      const errorMessage = video.error?.message || 'Unknown error';
      console.error('Video loading error:', video.error);
      reject(new Error(`Video error: ${errorMessage}`));
    };

    function cleanupAndResolve() {
      // Clean up
      video.removeAttribute('src');
      video.load();
      
      // Cache the frames before resolving
      videoFramesCache.set(cacheKey, frames);
      
      resolve(frames);
    }

    // Set the video source and start loading
    video.src = videoSrc;
    video.load();
  });
}

/**
 * Cache management functions for video utilities
 */
export const videoCacheManager = {
  // Clear all video caches
  clearAll(): void {
    videoMetadataCache.clear();
    videoFramesCache.clear();
  },

  // Clear metadata cache only
  clearMetadata(): void {
    videoMetadataCache.clear();
  },

  // Clear frames cache only
  clearFrames(): void {
    videoFramesCache.clear();
  },

  // Get cache statistics
  getStats(): {
    metadata: { size: number; memoryUsage: number; maxSize: number; maxMemoryMB: number };
    frames: { size: number; memoryUsage: number; maxSize: number; maxMemoryMB: number };
    totalMemoryUsage: number;
  } {
    const metadataStats = videoMetadataCache.getStats();
    const framesStats = videoFramesCache.getStats();
    
    return {
      metadata: metadataStats,
      frames: framesStats,
      totalMemoryUsage: metadataStats.memoryUsage + framesStats.memoryUsage
    };
  },

  // Check if memory usage is approaching limits and clean up if necessary
  performMemoryCleanup(): void {
    const stats = this.getStats();
    const totalMemoryMB = stats.totalMemoryUsage;
    const maxTotalMemoryMB = 300; // Total memory limit across all video caches

    if (totalMemoryMB > maxTotalMemoryMB) {
      console.warn(`Video cache memory usage (${totalMemoryMB.toFixed(2)}MB) exceeds limit (${maxTotalMemoryMB}MB). Performing cleanup.`);
      
      // First, try clearing frames cache (usually contains larger data)
      if (stats.frames.memoryUsage > stats.frames.maxMemoryMB * 0.7) {
        this.clearFrames();
      }
      
      // If still over limit, clear some metadata entries
      const newStats = this.getStats();
      if (newStats.totalMemoryUsage > maxTotalMemoryMB * 0.8) {
        // Clear oldest 25% of metadata entries
        const entriesToRemove = Math.ceil(stats.metadata.size * 0.25);
        let removed = 0;
        for (const [key] of videoMetadataCache.entries()) {
          if (removed >= entriesToRemove) break;
          videoMetadataCache.delete(key);
          removed++;
        }
      }
    }
  },

  // Check if a video's metadata is cached
  hasMetadata(videoSrc: string): boolean {
    return videoMetadataCache.has(videoSrc);
  },

  // Check if video frames are cached
  hasFrames(videoSrc: string, percentages: number[] = [0.33, 0.66]): boolean {
    const cacheKey = `${videoSrc}:${percentages.join(',')}`;
    return videoFramesCache.has(cacheKey);
  },

  // Remove specific video from cache
  removeVideo(videoSrc: string): void {
    videoMetadataCache.delete(videoSrc);
    
    // Remove any frame caches for this video (they might have different percentages)
    for (const [key] of videoFramesCache.entries()) {
      if (key.startsWith(videoSrc + ':')) {
        videoFramesCache.delete(key);
      }
    }
  }
};

// Periodic memory cleanup (runs every 5 minutes)
if (typeof window !== 'undefined') {
  setInterval(() => {
    videoCacheManager.performMemoryCleanup();
  }, 5 * 60 * 1000); // 5 minutes
}
