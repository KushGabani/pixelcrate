import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { VariableSizeList as List } from "react-window";
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
import { m as motion, AnimatePresence } from "framer-motion";
import {
  useReducedMotion,
  createSlideVariants,
  createOptimizedTransition,
} from "@/lib/motion";
import { ImageRenderer } from "@/components/ImageRenderer";
import { hasApiKey } from "@/services/aiAnalysisService";
import { useDragContext } from "./UploadZone";
import { useImagePreloader } from "@/hooks/useImagePreloader";
import { EmptyState } from "./EmptyState";
import {
  useDebouncedBatchedUpdates,
  useDebouncedScroll,
} from "@/hooks/useDebounce";
import "./text-shine.css"; // Import the text shine animation CSS

interface VirtualizedImageGridProps {
  images: ImageItem[];
  onImageClick: (image: ImageItem) => void;
  onImageDelete?: (id: string) => void;
  searchQuery?: string;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  retryAnalysis?: (imageId: string) => Promise<void>;
  thumbnailSize?: "small" | "medium" | "large" | "xl";
}

interface GridRow {
  images: ImageItem[];
  heights: number[];
  rowHeight: number;
}

const VirtualizedImageGrid: React.FC<VirtualizedImageGridProps> = ({
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
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageDimensions, setImageDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(
    new Map(),
  );

  // Debounced hover handlers with 100ms delay
  const debouncedSetHoveredImage = useDebouncedBatchedUpdates(
    useCallback((imageId: string | null) => {
      setHoveredImageId(imageId);
    }, []),
    100,
  );

  const handleMouseEnter = useCallback(
    (imageId: string) => {
      debouncedSetHoveredImage(imageId);
    },
    [debouncedSetHoveredImage],
  );

  const handleMouseLeave = useCallback(() => {
    debouncedSetHoveredImage(null);
  }, [debouncedSetHoveredImage]);

  // Debounced scroll handler for virtual list
  const debouncedScrollHandler = useDebouncedScroll(
    useCallback(
      (event: Event) => {
        // Hide any visible pattern overlays during scroll for better performance
        if (hoveredImageId) {
          setHoveredImageId(null);
        }
      },
      [hoveredImageId],
    ),
    100,
  );

  // Initialize optimized image preloader with throttling
  // Get drag context - must be called unconditionally at top level
  const dragContext = useDragContext();

  const preloader = useImagePreloader(images, {
    rootMargin: "600px", // Smaller margin for virtualized grid
    threshold: 0.1,
    preloadDistance: 5, // Conservative preloading for virtualized content
  });

  // Get column count based on thumbnail size and container width
  const getColumnCount = useCallback(
    (width: number) => {
      const baseWidth =
        thumbnailSize === "small"
          ? 200
          : thumbnailSize === "medium"
            ? 280
            : thumbnailSize === "large"
              ? 360
              : 480;
      const gap = 16;
      const columns = Math.max(
        1,
        Math.floor((width + gap) / (baseWidth + gap)),
      );
      return columns;
    },
    [thumbnailSize],
  );

  // Calculate column width based on container width and column count
  const getColumnWidth = useCallback(
    (containerWidth: number, columnCount: number) => {
      const gap = 16;
      const totalGapWidth = (columnCount - 1) * gap;
      return Math.floor((containerWidth - totalGapWidth) / columnCount);
    },
    [],
  );

  // Estimate image height based on aspect ratio
  const estimateImageHeight = useCallback(
    (image: ImageItem, columnWidth: number): number => {
      const dimensions = imageDimensions.get(image.id);
      if (dimensions) {
        return Math.floor((dimensions.height / dimensions.width) * columnWidth);
      }

      // Default estimation - assuming typical UI screenshot proportions
      const aspectRatio = 0.75; // Height / Width ratio
      return Math.floor(columnWidth * aspectRatio);
    },
    [imageDimensions],
  );

  // Create row-based layout for virtualization
  const createRowLayout = useMemo((): GridRow[] => {
    if (!containerSize.width || images.length === 0) {
      return [];
    }

    const columnCount = getColumnCount(containerSize.width);
    const columnWidth = getColumnWidth(containerSize.width, columnCount);
    const rows: GridRow[] = [];

    // Group images into rows
    for (let i = 0; i < images.length; i += columnCount) {
      const rowImages = images.slice(i, i + columnCount);
      const heights = rowImages.map((image) =>
        estimateImageHeight(image, columnWidth),
      );
      const rowHeight = Math.max(...heights) + 16; // Add gap

      rows.push({
        images: rowImages,
        heights,
        rowHeight,
      });
    }

    return rows;
  }, [
    images,
    containerSize.width,
    getColumnCount,
    getColumnWidth,
    estimateImageHeight,
  ]);

  // Update container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Load image dimensions for better height estimation
  useEffect(() => {
    const loadImageDimensions = async () => {
      const newDimensions = new Map(imageDimensions);

      for (const image of images) {
        if (!newDimensions.has(image.id)) {
          try {
            if (image.type === "image") {
              const img = new Image();
              img.onload = () => {
                newDimensions.set(image.id, {
                  width: img.width,
                  height: img.height,
                });
                setImageDimensions(new Map(newDimensions));
              };
              img.src = image.path;
            } else {
              // For videos, use a default aspect ratio or extract from metadata
              newDimensions.set(image.id, { width: 16, height: 9 });
            }
          } catch (error) {
            console.warn(
              `Failed to load dimensions for image ${image.id}:`,
              error,
            );
            // Use default dimensions
            newDimensions.set(image.id, { width: 4, height: 3 });
          }
        }
      }
    };

    loadImageDimensions();
  }, [images, imageDimensions]);

  // Check API key
  useEffect(() => {
    const checkApiKey = async () => {
      const exists = await hasApiKey();
      setHasOpenAIKey(exists);
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    if (settingsOpen === false) {
      const checkApiKey = async () => {
        const exists = await hasApiKey();
        setHasOpenAIKey(exists);
      };
      checkApiKey();
    }
  }, [settingsOpen]);

  // Auto-analyze images when API key is set
  useEffect(() => {
    if (previousKeyStatus !== true && hasOpenAIKey === true && retryAnalysis) {
      const imagesToAnalyze = images.filter(
        (img) =>
          (!img.patterns || img.patterns.length === 0) &&
          !img.isAnalyzing &&
          !img.error,
      );

      if (imagesToAnalyze.length > 0) {
        const analyzeQueue = async () => {
          for (const image of imagesToAnalyze) {
            await retryAnalysis(image.id);
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        };
        analyzeQueue();
      }
    }
    setPreviousKeyStatus(hasOpenAIKey);
  }, [hasOpenAIKey, images, retryAnalysis, previousKeyStatus]);

  // Prevent scrolling in empty state
  useEffect(() => {
    if (images.length === 0 && !searchQuery) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [images.length, searchQuery]);

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
    if (isAnimating) return;

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
  };

  const handleDeleteImage = (id: string) => {
    onImageDelete?.(id);
  };

  const renderPatternTags = (item: ImageItem) => {
    const isPillClickAnalysisEnabled =
      localStorage.getItem("dev_enable_pill_click_analysis") === "true";

    // Handle analyzing state
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

    // Handle error state
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

    // Handle patterns or no patterns case
    return item.patterns && item.patterns.length > 0 ? (
      <div className="flex flex-wrap gap-1">
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
        {item.patterns.slice(0, 4).map((pattern, index) => (
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
    ) : null;
  };

  // Use reduced motion hook
  const prefersReducedMotion = useReducedMotion();

  // Row renderer for the virtual list
  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const rows = createRowLayout;
      const row = rows[index];

      if (!row) {
        return <div style={style} />;
      }

      const columnCount = getColumnCount(containerSize.width);
      const columnWidth = getColumnWidth(containerSize.width, columnCount);
      const gap = 16;

      return (
        <div style={style} className="flex gap-4 px-2">
          {row.images.map((image, columnIndex) => {
            let ref = imageRefs.current.get(image.id);
            if (!ref) {
              ref = React.createRef<HTMLDivElement>();
              imageRefs.current.set(image.id, ref);
            }

            const isSelected = clickedImageId === image.id;
            const imageHeight = row.heights[columnIndex];

            return (
              <div key={image.id} style={{ width: columnWidth, flexShrink: 0 }}>
                <div
                  ref={ref}
                  className="rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800 shadow-sm hover:shadow-md relative group w-full cursor-pointer"
                  onClick={() => handleImageClick(image, ref)}
                  onMouseEnter={() => handleMouseEnter(image.id)}
                  onMouseLeave={handleMouseLeave}
                  style={{
                    opacity: isSelected ? 0 : 1,
                    visibility: isSelected ? "hidden" : "visible",
                    pointerEvents: isAnimating ? "none" : "auto",
                    height: imageHeight,
                  }}
                >
                  <div className="relative h-full">
                    <ImageRenderer
                      image={image}
                      alt="UI Screenshot"
                      className="w-full h-full object-cover rounded-t-lg"
                      controls={false}
                      autoPlay={false}
                      preloader={preloader}
                    />

                    <AnimatePresence>
                      {hoveredImageId === image.id && (
                        <motion.div
                          className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent"
                          {...createSlideVariants(
                            prefersReducedMotion,
                            "up",
                            10,
                          )}
                          style={{
                            bottom: "-2px",
                            pointerEvents: "none",
                            // Force GPU acceleration
                            transform: "translate3d(0, 0, 0)",
                            willChange: "transform, opacity",
                            backfaceVisibility: "hidden",
                          }}
                        >
                          <div className="pointer-events-auto">
                            {renderPatternTags(image)}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

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
                          />
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
          {/* Fill remaining space if row is not full */}
          {Array.from({ length: columnCount - row.images.length }).map(
            (_, index) => (
              <div
                key={`empty-${index}`}
                style={{ width: columnWidth, flexShrink: 0 }}
              />
            ),
          )}
        </div>
      );
    },
    [
      createRowLayout,
      containerSize.width,
      getColumnCount,
      getColumnWidth,
      clickedImageId,
      hoveredImageId,
      isAnimating,
      handleImageClick,
      renderPatternTags,
      preloader,
      onImageDelete,
      handleDeleteImage,
    ],
  );

  // Get item size for virtual list (must be declared before early returns)
  const getItemSize = useCallback(
    (index: number) => {
      return createRowLayout[index]?.rowHeight || 200;
    },
    [createRowLayout],
  );

  return (
    <div
      className={`w-full px-4 pb-4 flex-1 flex flex-col ${images.length === 0 && !searchQuery ? "overflow-hidden" : ""}`}
    >
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
            ref={containerRef}
            animate={modalOpen ? { opacity: 0.3 } : { opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full flex-1"
            style={{ maxWidth: "none" }}
          >
            {containerSize.width > 0 && (
              <List
                height={containerSize.height || 600}
                itemCount={createRowLayout.length}
                itemSize={getItemSize}
                width={containerSize.width}
                overscanCount={3}
                onScroll={debouncedScrollHandler}
              >
                {Row}
              </List>
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

export default VirtualizedImageGrid;
