import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ImageItem } from '@/hooks/useImageStore';
import { useImagePreloader } from '@/hooks/useImagePreloader';
import { useDragContext } from './UploadZone';

interface ImageRendererProps {
  image: ImageItem;
  className?: string;
  alt?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => void;
  currentTime?: number;
  preloader?: ReturnType<typeof useImagePreloader>;
}

export const ImageRenderer = React.memo(function ImageRenderer({
  image,
  className = "",
  alt = "",
  controls = false,
  autoPlay = false,
  muted = true,
  loop = false,
  onLoad,
  currentTime,
  preloader
}: ImageRendererProps) {
  const [loadError, setLoadError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Get drag context for internal drag detection
  const dragContext = useDragContext();
  
  // Video thumbnail state (moved to top level)
  const [isHovering, setIsHovering] = useState(false);
  const [thumbnailTime, setThumbnailTime] = useState(0);

  // Set video current time when it's ready
  useEffect(() => {
    if (videoRef.current && typeof currentTime === 'number') {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Determine if we're running in Electron
  const isElectron = window && 
    typeof window.electron !== 'undefined' && 
    window.electron !== null;

  // Process the media URL
  let mediaUrl = image.url;
  const isLocalFileProtocol = mediaUrl?.startsWith('local-file://');
  
  // Check for invalid URLs
  if (!mediaUrl) {
    console.error('Missing URL for media:', image.id);
    setLoadError(true);
    mediaUrl = ''; // Set to empty string to avoid undefined errors
  }

  // In browser development mode, we can't use local-file:// protocol for security reasons
  // IMPORTANT: Always use local-file:// protocol for local files. file:// protocol does not work locally.
  if (isLocalFileProtocol && !isElectron) {
    // For videos, use the poster image instead of trying to load the video
    if (image.type === 'video') {
      // If we have a poster URL, we'll use that in the UI
      if (!image.posterUrl) {
        setLoadError(true); // Mark as error if no poster available
      }
    } else {
      // For images in browser, use a placeholder
      mediaUrl = '/placeholder.svg';
    }
  }

  // For videos in thumbnail view, always use the poster if available
  const shouldUsePoster = image.type === 'video' && !controls && image.posterUrl;
  
  // Handle media loading errors
  const handleError = (error: unknown) => {
    console.error('Error loading media:', error);
    if (mediaUrl?.startsWith('local-file://') && image.type === 'video' && isElectron) {
      console.error('Error loading video with local-file:// protocol:', error);
    }
    setLoadError(true);
  };

  // Handle media load success
  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLVideoElement | HTMLImageElement>) => {
    if (onLoad) {
      onLoad(e);
    }
  }, [onLoad]);

  // Handle drag start - mark as internal drag operation
  const handleDragStart = useCallback(() => {
    if (dragContext?.setInternalDragActive) {
      dragContext.setInternalDragActive(true);
    }
  }, [dragContext]);

  // Handle drag end - reset internal drag flag
  const handleDragEnd = useCallback(() => {
    if (dragContext?.setInternalDragActive) {
      dragContext.setInternalDragActive(false);
    }
  }, [dragContext]);

  // Check if image is preloaded/cached
  const isImageCached = preloader?.isImageCached(image.url) || false;
  const isPosterCached = image.posterUrl ? (preloader?.isImageCached(image.posterUrl) || false) : false;
  
  // Use cached image if available - optimized for speed
  const getCachedImageSrc = useCallback((url: string) => {
    if (preloader?.isImageCached(url)) {
      const cachedImg = preloader.getCachedImage(url);
      if (cachedImg?.src) {
        return cachedImg.src;
      }
    }
    return url;
  }, [preloader]);

  // Check if we should use object URL for better performance
  const getOptimizedImageSrc = useCallback((url: string) => {
    // For local files, return as-is since they're already optimized
    if (url.startsWith('local-file://')) {
      return url;
    }
    return getCachedImageSrc(url);
  }, [getCachedImageSrc]);

  // Display error state if media failed to load
  if (loadError) {
    // Special handling for videos with poster images
    if (image.type === 'video' && image.posterUrl) {
      return (
        <div className={`relative bg-gray-200 flex flex-col items-center justify-center ${className}`}>
          <img 
            src={image.posterUrl} 
            alt={`Video thumbnail ${image.id}`}
            className={`w-full h-auto object-cover ${className}`}
            style={{ minHeight: '120px' }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white p-4">
            <div className="text-center">
              <p className="font-medium">Video playback unavailable</p>
              <p className="text-sm mt-1 text-gray-200">This video cannot be played in the browser</p>
              {isElectron && (
                <p className="text-xs mt-2 text-gray-300">Try opening the file directly</p>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // Default error state for other media types
    return (
      <div className={`bg-gray-200 flex items-center justify-center ${className}`}>
        <span className="text-gray-500">Media failed to load</span>
      </div>
    );
  }

  // Render video element
  if (image.type === "video") {
    // In thumbnail view (grid)
    if (!controls) {
      // If we're in a browser and it's a local file, don't try to play the video on hover
      const canPlayOnHover = !(isLocalFileProtocol && !isElectron);
      
      return (
        <div 
          className={`relative ${className}`}
          onMouseEnter={() => canPlayOnHover && setIsHovering(true)}
          onMouseLeave={() => {
            setIsHovering(false);
            if (videoRef.current) {
              setThumbnailTime(videoRef.current.currentTime);
              videoRef.current.pause();
            }
          }}
        >
          {/* Always render the poster image as the base layer */}
          {image.posterUrl ? (
            <img 
              src={getOptimizedImageSrc(image.posterUrl)} 
              alt={`Video thumbnail ${image.id}`}
              className={`w-full h-auto object-cover ${className}`}
              style={{ minHeight: '120px' }}
              loading="eager"
              decoding="async"
              fetchpriority="high"
              onLoad={handleLoad}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ) : (
            // Fallback if no poster is available
            <div className={`flex items-center justify-center bg-gray-300 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 ${className}`} style={{ minHeight: '200px' }}>
              <span>Video thumbnail not available</span>
            </div>
          )}

          {/* Video layer that appears on hover - only if we can play it */}
          {isHovering && canPlayOnHover && (
            <div className="absolute inset-0">
              <video 
                ref={videoRef}
                src={mediaUrl}
                className={`w-full h-full object-cover ${className}`}
                autoPlay
                muted
                loop
                playsInline
                crossOrigin="anonymous"
                preload="metadata"
                poster={image.posterUrl || undefined}
                onLoadedMetadata={handleLoad}
                onError={(e) => {
                  // If there's an error playing the video on hover, just hide the video
                  setIsHovering(false);
                }}
              />
            </div>
          )}

          {/* Video indicator icon */}
          <div className="absolute bottom-2 right-2 bg-black/70 p-1 rounded text-white text-xs">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"></path>
            </svg>
          </div>
        </div>
      );
    }

    // In full view (modal with controls)
    // If we're in a browser and it's a local file, show an error message
    if (isLocalFileProtocol && !isElectron) {
      return (
        <div className={`relative bg-gray-800 flex flex-col items-center justify-center ${className}`}>
          {image.posterUrl && (
            <img 
              src={image.posterUrl} 
              alt={`Video thumbnail ${image.id}`}
              className="w-full h-full object-contain opacity-30"
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-8">
            <div className="text-center max-w-md">
              <h3 className="text-xl font-medium mb-2">Video Cannot Be Played</h3>
              <p className="mb-4">
                This video file cannot be played in the browser due to security restrictions that prevent access to local files.
              </p>
              <p className="text-sm text-gray-300">
                To view this video, you need to use the desktop app or open it directly in a video player.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <video 
        ref={videoRef}
        src={mediaUrl}
        className={className}
        poster={image.posterUrl || undefined}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        onError={handleError}
        onLoadedMetadata={handleLoad}
        playsInline
        controlsList="nodownload"
        preload="auto"
        crossOrigin="anonymous"
      />
    );
  }

  // Default to image rendering
  const isTallImage = image.height > image.width * 2;
  
  if (isTallImage && !controls) {
    return (
      <div className="relative w-full aspect-[1/2] overflow-hidden">
        <img 
          src={getOptimizedImageSrc(mediaUrl)} 
          alt={alt || `Image ${image.id}`} 
          className={`absolute inset-0 w-full h-full object-cover ${className}`}
          loading="eager"
          decoding="async"
          fetchpriority="high"
          onError={handleError}
          onLoad={handleLoad}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      </div>
    );
  }
  
  return (
    <img 
      src={getOptimizedImageSrc(mediaUrl)} 
      alt={alt || `Image ${image.id}`} 
      className={className}
      loading="eager"
      decoding="async"
      fetchpriority="high"
      onError={handleError}
      onLoad={handleLoad}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  );
});