import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ImageItem } from "@/hooks/useImageStore";
import {
  X,
  AlertCircle,
  Loader2,
  Key,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AnimatedImageModal from "./AnimatedImageModal";
import { motion, AnimatePresence } from "framer-motion";
import { ImageRenderer } from "@/components/ImageRenderer";
import Masonry from "react-masonry-css";
import { VariableSizeList as List } from "react-window";
import "./masonry-grid.css"; // We'll create this CSS file
import "./text-shine.css"; // Import the text shine animation CSS
import { hasApiKey } from "@/services/aiAnalysisService";
import { useDragContext } from "./UploadZone";
import { useImagePreloader } from "@/hooks/useImagePreloader";
import { EmptyState } from "./EmptyState";

interface ImageGridProps {
  images: ImageItem[];
  onImageClick: (image: ImageItem) => void;
  onImageDelete?: (id: string) => void;
  searchQuery?: string;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  retryAnalysis?: (imageId: string) => Promise<void>;
  thumbnailSize?: "small" | "medium" | "large" | "xl";
}

const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onImageClick,
  onImageDelete,
  searchQuery = "",
  onOpenSettings,
  settingsOpen = false,
  retryAnalysis,
  thumbnailSize = "medium",
}) => {
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedImageRef, setSelectedImageRef] =
    useState<React.RefObject<HTMLDivElement> | null>(null);
  const [clickedImageId, setClickedImageId] = useState<string | null>(null);
  const [exitAnimationComplete, setExitAnimationComplete] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState<boolean | null>(null);
  const [previousKeyStatus, setPreviousKeyStatus] = useState<boolean | null>(
    null,
  );

  // Image refs for animations
  const imageRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(
    new Map(),
  );

  // Initialize image preloader - preloads everything so settings are less critical
  const preloader = useImagePreloader(images, {
    rootMargin: "1000px",
    threshold: 0.1,
    preloadDistance: 5, // Reduced since everything gets preloaded anyway
  });

  // Get drag context with fallback for when context is not available
  const dragContext = { isDragging: false };
  try {
    const context = useDragContext();
    if (context) {
      Object.assign(dragContext, context);
    }
  } catch (error) {
    // Context not available, use default (not dragging)
    console.log("Drag context not available, using default");
  }

  // Check if the Gemini API key is set
  useEffect(() => {
    const checkApiKey = async () => {
      const exists = await hasApiKey();
      setHasOpenAIKey(exists);
    };

    checkApiKey();
  }, []);

  // Recheck API key when settings panel closes
  useEffect(() => {
    if (settingsOpen === false) {
      // When settings panel closes, check if API key status has changed
      const checkApiKey = async () => {
        const exists = await hasApiKey();
        setHasOpenAIKey(exists);
      };

      checkApiKey();
    }
  }, [settingsOpen]);

  // Analyze all unanalyzed images when API key is newly set
  useEffect(() => {
    // Check if key status changed from false/null to true
    if (previousKeyStatus !== true && hasOpenAIKey === true && retryAnalysis) {
      // Find all images that don't have patterns and aren't analyzing
      const imagesToAnalyze = images.filter(
        (img) =>
          (!img.patterns || img.patterns.length === 0) &&
          !img.isAnalyzing &&
          !img.error,
      );

      if (imagesToAnalyze.length > 0) {
        // Create a queue of images to analyze
        const analyzeQueue = async () => {
          for (const image of imagesToAnalyze) {
            await retryAnalysis(image.id);
            // Small delay to avoid overwhelming the API
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        };

        analyzeQueue();
      }
    }

    // Update previous key status for next comparison
    setPreviousKeyStatus(hasOpenAIKey);
  }, [hasOpenAIKey, images, retryAnalysis, previousKeyStatus]);

  // Prevent scrolling when in empty state
  useEffect(() => {
    // Only add the no-scroll style when we're in empty state and not searching
    if (images.length === 0 && !searchQuery) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [images.length, searchQuery]);

  // Virtualization configuration
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const [useVirtualization, setUseVirtualization] = useState(false);
  
  // Update container size on resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  // Enable virtualization only for large datasets
  useEffect(() => {
    setUseVirtualization(images.length > 50); // Threshold for virtualization
  }, [images.length]);

  // Dynamic responsive breakpoints based on thumbnail size
  const getBreakpointColumnsObj = () => {
    switch (thumbnailSize) {
      case "small":
        return {
          default: 6, // More columns for smaller thumbnails
          1536: 6,
          1280: 5,
          1024: 4,
          640: 3,
          480: 2,
        };
      case "medium":
        return {
          default: 4, // Default size
          1536: 4,
          1280: 3,
          1024: 2,
          640: 1,
          480: 1,
        };
      case "large":
        return {
          default: 3, // Fewer columns for larger thumbnails
          1536: 3,
          1280: 2,
          1024: 2,
          640: 1,
          480: 1,
        };
      case "xl":
        return {
          default: 2, // Very few columns for extra large thumbnails
          1536: 2,
          1280: 2,
          1024: 1,
          640: 1,
          480: 1,
        };
      default:
        return {
          default: 4,
          1536: 4,
          1280: 3,
          1024: 2,
          640: 1,
          480: 1,
        };
    }
  };

  const breakpointColumnsObj = getBreakpointColumnsObj();
  
  // Calculate column count based on current window width
  const getColumnCount = useCallback(() => {
    const width = containerSize.width || window.innerWidth;
    const breakpoints = breakpointColumnsObj;
    
    if (width >= 1536) return breakpoints[1536] || breakpoints.default;
    if (width >= 1280) return breakpoints[1280] || breakpoints.default;
    if (width >= 1024) return breakpoints[1024] || breakpoints.default;
    if (width >= 640) return breakpoints[640] || breakpoints.default;
    if (width >= 480) return breakpoints[480] || breakpoints.default;
    
    return breakpoints.default;
  }, [containerSize.width, breakpointColumnsObj]);
  
  // Virtualized row data for masonry
  const virtualizedData = useMemo(() => {
    if (!useVirtualization) return [];
    
    const columnCount = getColumnCount();
    const rows: ImageItem[][] = [];
    
    // Group images into rows
    for (let i = 0; i < images.length; i += columnCount) {
      const row = images.slice(i, i + columnCount);
      rows.push(row);
    }
    
    return rows;
  }, [images, getColumnCount, useVirtualization]);
  
  // Calculate row heights for virtualization
  const getRowHeight = useCallback((index: number) => {
    // Base height based on thumbnail size
    const baseHeight = {
      small: 200,
      medium: 250,
      large: 300,
      xl: 400
    }[thumbnailSize] || 250;
    
    // Add some variation for masonry effect
    const variation = (index % 3) * 50;
    return baseHeight + variation + 16; // Add margin
  }, [thumbnailSize]);

  // Initialize image refs and setup intersection observer
  useEffect(() => {
    images.forEach((image) => {
      if (!imageRefs.current.has(image.id)) {
        const ref = React.createRef<HTMLDivElement>();
        imageRefs.current.set(image.id, ref);
      }
    });

    // Setup intersection observer for existing refs
    const timeoutId = setTimeout(() => {
      imageRefs.current.forEach((ref, imageId) => {
        if (ref.current) {
          preloader.observeElement(ref.current, imageId);
        }
      });
    }, 0);

    // Cleanup observers for removed images
    return () => {
      clearTimeout(timeoutId);
      const currentImageIds = new Set(images.map((img) => img.id));
      for (const [imageId] of imageRefs.current) {
        if (!currentImageIds.has(imageId)) {
          preloader.unobserveElement(imageId);
          imageRefs.current.delete(imageId);
        }
      }
    };
  }, [images, preloader]);

  // Reset exitAnimationComplete after a delay
  useEffect(() => {
    if (exitAnimationComplete) {
      const timeoutId = setTimeout(() => {
        setExitAnimationComplete(false);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [exitAnimationComplete]);

  const handleImageClick = (
    image: ImageItem,
    ref: React.RefObject<HTMLDivElement>,
  ) => {
    if (isAnimating) return; // Prevent clicks during animation

    setIsAnimating(true);
    setSelectedImage(image);
    setSelectedImageRef(ref);
    setModalOpen(true);
    setClickedImageId(image.id);
    onImageClick(image);
  };

  const handleAnimationComplete = (definition: string) => {
    if (definition === "exit") {
      setExitAnimationComplete(true);
      setIsAnimating(false);
      setClickedImageId(null);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    // Don't reset clickedImageId here - wait for animation to complete
    // The thumbnail should stay hidden until handleAnimationComplete is called
  };

  const handleDeleteImage = (id: string) => {
    onImageDelete?.(id);
  };

  const renderPatternTags = (item: ImageItem) => {
    if (!item.patterns || item.patterns.length === 0) {
      if (item.isAnalyzing) {
        return (
          <div className="inline-flex items-center gap-1 text-xs text-primary-background bg-secondary px-2 py-1 rounded-md">
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            <span className="text-shine">Analyzing...</span>
          </div>
        );
      }
      if (item.error) {
        return (
          <div
            className="inline-flex items-center gap-1 text-xs text-destructive-foreground bg-destructive/80 px-2 py-1 rounded-md hover:bg-destructive transition-all duration-200 hover:shadow-sm active:bg-destructive/90"
            onClick={(e) => {
              e.stopPropagation();
              if (retryAnalysis) {
                retryAnalysis(item.id);
              }
            }}
            title="Click to retry analysis"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Analysis failed</span>
          </div>
        );
      }
      return null;
    }

    // Check if pill click analysis is enabled
    const isPillClickAnalysisEnabled =
      localStorage.getItem("dev_enable_pill_click_analysis") === "true";

    // If analyzing, show loading state for all pills
    if (item.isAnalyzing) {
      return (
        <div className="flex flex-wrap gap-1">
          <div className="inline-flex items-center gap-1 text-xs text-primary-background bg-secondary px-2 py-1 rounded-md">
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            <span className="text-shine">Analyzing...</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-1">
        {/* Show image summary as the first pill */}
        {item.patterns[0]?.imageSummary && (
          <span
            className={`text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md cursor-default ${
              isPillClickAnalysisEnabled
                ? "hover:bg-secondary/90 transition-colors"
                : ""
            }`}
            title={item.patterns[0]?.imageContext || "Type of interface"}
            onClick={(e) => {
              if (isPillClickAnalysisEnabled) {
                e.stopPropagation();
                if (retryAnalysis) {
                  retryAnalysis(item.id);
                }
              }
            }}
          >
            {item.patterns[0]?.imageSummary}
          </span>
        )}
        {/* Show top 3 patterns after the summary */}
        {item.patterns
          .slice(0, 4) // Only display top 4 patterns
          .map((pattern, index) => (
            <span
              key={index}
              className={`text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md cursor-default ${
                isPillClickAnalysisEnabled
                  ? "hover:bg-secondary/90 transition-colors"
                  : ""
              }`}
              title={`Confidence: ${Math.round(pattern.confidence * 100)}%`}
              onClick={(e) => {
                if (isPillClickAnalysisEnabled) {
                  e.stopPropagation();
                  if (retryAnalysis) {
                    retryAnalysis(item.id);
                  }
                }
              }}
            >
              {pattern.name}
            </span>
          ))}
      </div>
    );
  };

  // Memoize placeholder heights to prevent constant re-rendering
  const placeholderHeights = React.useMemo(() => {
    // Define possible height ranges
    const heightRanges = [
      { min: 150, max: 250 }, // Short
      { min: 250, max: 350 }, // Medium
      { min: 350, max: 450 }, // Tall
    ];

    // Generate fixed heights for placeholders
    return Array.from({ length: 12 }).map((_, index) => {
      const heightIndex = index % 3;
      const range = heightRanges[heightIndex];
      return range.min + Math.floor(Math.random() * (range.max - range.min));
    });
  }, []); // Empty dependency array ensures this only runs once

  // Empty state placeholder masonry
  const renderEmptyStatePlaceholders = () => {
    const { isDragging } = dragContext;

    return (
      <Masonry
        breakpointCols={breakpointColumnsObj}
        className={`my-masonry-grid ${isDragging ? "opacity-30 blur-[1px]" : "opacity-50"} transition-all duration-300`}
        columnClassName="my-masonry-grid_column"
      >
        {placeholderHeights.map((height, index) => (
          <div key={index} className="masonry-item">
            <motion.div
              className="rounded-lg overflow-hidden bg-gray-300 dark:bg-zinc-800 w-full transition-all duration-300"
              style={{ height: `${height}px` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: isDragging ? 0.2 : 0.5 }}
              transition={{
                opacity: { duration: 0.5, delay: index * 0.05 },
              }}
            />
          </div>
        ))}
      </Masonry>
    );
  };

  // Empty state card for API key setup or drag-drop instruction
  const renderEmptyStateCard = () => {
    // Get the drag state from context
    const { isDragging } = dragContext;

    return (
      <motion.div
        className={`bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm shadow-2xl rounded-xl w-full overflow-hidden pointer-events-auto border border-gray-200 dark:border-zinc-800 transition-all duration-300 ${
          isDragging ? "opacity-80 blur-[1px]" : "opacity-100"
        }`}
      >
        {hasOpenAIKey === null ? (
          // Loading state
          <div className="p-6">
            <div className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
                </div>
              </div>
            </div>
          </div>
        ) : hasOpenAIKey ? (
          // API key is set - show drag and drop instructions
          <>
            <div className="p-8 select-none">
              <div className="rounded-full bg-gray-100 dark:bg-zinc-800 w-14 h-14 flex items-center justify-center mb-5">
                <Upload className="h-7 w-7 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Drag and drop images or videos here
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                They will be automatically analysed for UI patterns and
                organised.
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-zinc-800/50 px-6 py-4 border-t border-gray-200 dark:border-zinc-800 select-none">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                You can also paste images from clipboard (⌘+V)
              </p>
            </div>
          </>
        ) : (
          // No API key - show add API key card
          <>
            <div className="p-8 select-none">
              <div className="rounded-full bg-gray-100 dark:bg-zinc-800 w-14 h-14 flex items-center justify-center mb-5">
                <Key className="h-7 w-7 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Add your Gemini API key
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Unlock automatic pattern detection in screenshots by adding your
                Gemini API key.
              </p>
              <Button
                onClick={() => {
                  onOpenSettings?.();
                }}
                className="w-full bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white py-5 text-base font-medium"
              >
                Add API Key
              </Button>
            </div>
            <div className="bg-gray-50 dark:bg-zinc-800/50 px-6 py-4 border-t border-gray-200 dark:border-zinc-800 select-none">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                You can still upload and organize screenshots without an API
                key.
              </p>
            </div>
          </>
        )}
      </motion.div>
    );
  };

  // Virtualized row renderer
  const VirtualizedRow = useCallback(({ index, style }: any) => {
    const rowImages = virtualizedData[index];
    if (!rowImages || rowImages.length === 0) {
      return <div style={style} />;
    }

    return (
      <div style={style}>
        <Masonry
          breakpointCols={getColumnCount()}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {rowImages.map((image) => {
            let ref = imageRefs.current.get(image.id);
            if (!ref) {
              ref = React.createRef<HTMLDivElement>();
              imageRefs.current.set(image.id, ref);
            }

            const isSelected = clickedImageId === image.id;

            return (
              <div key={image.id} className="masonry-item">
                <div
                  ref={ref}
                  className="rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800 shadow-sm hover:shadow-md relative group w-full"
                  onClick={() => handleImageClick(image, ref)}
                  onMouseEnter={() => setHoveredImageId(image.id)}
                  onMouseLeave={() => setHoveredImageId(null)}
                  style={{
                    opacity: isSelected ? 0 : 1,
                    visibility: isSelected ? "hidden" : "visible",
                    pointerEvents: isAnimating ? "none" : "auto",
                  }}
                >
                  <div className="relative">
                    <ImageRenderer
                      image={image}
                      alt="UI Screenshot"
                      className="w-full h-auto object-cover rounded-t-lg"
                      controls={false}
                      autoPlay={false}
                      preloader={preloader}
                    />

                    <AnimatePresence>
                      {hoveredImageId === image.id && (
                        <motion.div
                          id={`pattern-tags-${image.id}`}
                          className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          style={{
                            bottom: "-2px",
                            pointerEvents: "none",
                          }}
                        >
                          <div className="pointer-events-auto">
                            {renderPatternTags(image)}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Video indicator icon */}
                    {image.type === "video" && (
                      <div className="absolute bottom-2 right-2 bg-black/70 p-1 rounded text-white text-xs z-10">
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                            clipRule="evenodd"
                          ></path>
                        </svg>
                      </div>
                    )}

                    {onImageDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full h-6 w-6 bg-black/60 text-white hover:text-white hover:bg-black/80"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteImage(image.id);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Masonry>
      </div>
    );
  }, [virtualizedData, getColumnCount, imageRefs, clickedImageId, isAnimating, hoveredImageId, preloader, onImageDelete, handleImageClick, renderPatternTags, handleDeleteImage]);

  return (
    <div
      ref={containerRef}
      className={`w-full px-4 pb-4 flex-1 flex flex-col ${images.length === 0 && !searchQuery ? "overflow-hidden" : ""}`}
    >
      {/* Debug info - remove in production */}
      <div className="hidden">{`Images: ${images.length}, HasKey: ${hasOpenAIKey}, IsSearching: ${searchQuery !== ""}`}</div>

      {images.length === 0 ? (
        <div className="flex-1 flex items-stretch">
          {searchQuery ? (
            <div className="flex justify-center items-center w-full min-h-[50vh]">
              <p className="text-sm text-muted-foreground select-none">
                Nothing found
              </p>
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      ) : (
        <>
          <motion.div
            animate={modalOpen ? { opacity: 0.3 } : { opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full"
            style={{ maxWidth: "none" }}
          >
            {useVirtualization && containerSize.height > 0 ? (
              <List
                ref={listRef}
                height={containerSize.height}
                itemCount={virtualizedData.length}
                itemSize={getRowHeight}
                width={containerSize.width}
                className="virtualized-masonry"
                overscanCount={2}
              >
                {VirtualizedRow}
              </List>
            ) : (
              <Masonry
                breakpointCols={breakpointColumnsObj}
                className="my-masonry-grid"
                columnClassName="my-masonry-grid_column"
              >
                {images.map((image) => {
                  let ref = imageRefs.current.get(image.id);
                  if (!ref) {
                    ref = React.createRef<HTMLDivElement>();
                    imageRefs.current.set(image.id, ref);
                  }

                  const isSelected = clickedImageId === image.id;

                  return (
                    <div key={image.id} className="masonry-item">
                      <div
                        ref={ref}
                        className="rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800 shadow-sm hover:shadow-md relative group w-full"
                        onClick={() => handleImageClick(image, ref)}
                        onMouseEnter={() => setHoveredImageId(image.id)}
                        onMouseLeave={() => setHoveredImageId(null)}
                        style={{
                          opacity: isSelected ? 0 : 1,
                          visibility: isSelected ? "hidden" : "visible",
                          pointerEvents: isAnimating ? "none" : "auto",
                        }}
                      >
                        <div className="relative">
                          <ImageRenderer
                            image={image}
                            alt="UI Screenshot"
                            className="w-full h-auto object-cover rounded-t-lg"
                            controls={false}
                            autoPlay={false}
                            preloader={preloader}
                          />

                          <AnimatePresence>
                            {hoveredImageId === image.id && (
                              <motion.div
                                id={`pattern-tags-${image.id}`}
                                className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                style={{
                                  bottom: "-2px",
                                  pointerEvents: "none",
                                }}
                              >
                                <div className="pointer-events-auto">
                                  {renderPatternTags(image)}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Video indicator icon */}
                          {image.type === "video" && (
                            <div className="absolute bottom-2 right-2 bg-black/70 p-1 rounded text-white text-xs z-10">
                              <svg
                                className="w-4 h-4"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                                  clipRule="evenodd"
                                ></path>
                              </svg>
                            </div>
                          )}

                          {onImageDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full h-6 w-6 bg-black/60 text-white hover:text-white hover:bg-black/80"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteImage(image.id);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Masonry>
            )}
          </motion.div>

          <AnimatedImageModal
            isOpen={modalOpen}
            onClose={closeModal}
            selectedImage={selectedImage}
            selectedImageRef={selectedImageRef}
            patternElements={null}
            onAnimationComplete={handleAnimationComplete}
          />
        </>
      )}
    </div>
  );
};

export default ImageGrid;
