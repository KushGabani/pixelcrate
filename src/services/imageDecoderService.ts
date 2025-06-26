/**
 * Image Decoder Service
 *
 * Manages Web Worker-based image decoding to prevent main thread blocking.
 * Provides a clean interface for offloading image decode operations.
 */

interface ImageDecodeRequest {
  id: string;
  imageUrl: string;
  options?: ImageBitmapOptions;
}

interface ImageDecodeResponse {
  id: string;
  success: boolean;
  imageBitmap?: ImageBitmap;
  error?: string;
  fallbackImageData?: {
    width: number;
    height: number;
    data: ArrayBuffer;
  };
}

interface DecodedImageResult {
  imageBitmap?: ImageBitmap;
  fallbackImage?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
}

class ImageDecoderService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (result: DecodedImageResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private requestIdCounter = 0;
  private workerInitialized = false;

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker() {
    try {
      // Create worker from the TypeScript file
      this.worker = new Worker(
        new URL("../workers/imageDecoderWorker.ts", import.meta.url),
        { type: "module" },
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);
      this.workerInitialized = true;

      console.log("Image decoder worker initialized successfully");
    } catch (error) {
      console.warn("Failed to initialize image decoder worker:", error);
      this.worker = null;
      this.workerInitialized = false;
    }
  }

  private handleWorkerMessage(event: MessageEvent<ImageDecodeResponse>) {
    const { id, success, imageBitmap, error, fallbackImageData } = event.data;
    const request = this.pendingRequests.get(id);

    if (!request) {
      console.warn("Received response for unknown request ID:", id);
      return;
    }

    this.pendingRequests.delete(id);

    if (success) {
      const result: DecodedImageResult = {};

      if (imageBitmap) {
        result.imageBitmap = imageBitmap;
      } else if (fallbackImageData) {
        // Convert fallback data to canvas
        const canvas = document.createElement("canvas");
        canvas.width = fallbackImageData.width;
        canvas.height = fallbackImageData.height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          const imageData = new ImageData(
            new Uint8ClampedArray(fallbackImageData.data),
            fallbackImageData.width,
            fallbackImageData.height,
          );
          ctx.putImageData(imageData, 0, 0);
          result.canvas = canvas;
        }
      }

      request.resolve(result);
    } else {
      request.reject(new Error(error || "Unknown decoding error"));
    }
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error("Image decoder worker error:", error);

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error("Worker error: " + error.message));
    }
    this.pendingRequests.clear();

    // Try to reinitialize the worker
    this.initializeWorker();
  }

  /**
   * Decode an image using the Web Worker
   */
  async decodeImage(
    imageUrl: string,
    options?: ImageBitmapOptions,
  ): Promise<DecodedImageResult> {
    // Fallback to main thread if worker is not available
    if (!this.worker || !this.workerInitialized) {
      return this.decodeImageMainThread(imageUrl);
    }

    // Handle local-file:// URLs by converting to base64 first
    // Web Workers can't access Electron's custom protocol handlers
    let processedImageUrl = imageUrl;
    if (
      imageUrl.startsWith("local-file://") &&
      typeof window !== "undefined" &&
      window.electron
    ) {
      try {
        console.log(
          "Converting local-file:// URL to base64 for Web Worker:",
          imageUrl,
        );
        processedImageUrl =
          await window.electron.convertImageToBase64(imageUrl);
      } catch (error) {
        console.warn(
          "Failed to convert local-file:// to base64, falling back to main thread:",
          error,
        );
        return this.decodeImageMainThread(imageUrl);
      }
    }

    const id = `decode_${++this.requestIdCounter}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request: ImageDecodeRequest = {
        id,
        imageUrl: processedImageUrl,
        options,
      };

      this.worker!.postMessage(request);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Image decode timeout"));
        }
      }, 30000);
    });
  }

  /**
   * Fallback image decoding on main thread
   */
  private async decodeImageMainThread(
    imageUrl: string,
  ): Promise<DecodedImageResult> {
    // Handle local-file:// URLs by converting to base64 first
    let processedImageUrl = imageUrl;
    if (
      imageUrl.startsWith("local-file://") &&
      typeof window !== "undefined" &&
      window.electron
    ) {
      try {
        console.log(
          "Converting local-file:// URL to base64 for main thread:",
          imageUrl,
        );
        processedImageUrl =
          await window.electron.convertImageToBase64(imageUrl);
      } catch (error) {
        console.error("Failed to convert local-file:// to base64:", error);
        throw new Error("Cannot load local file: " + error);
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = async () => {
        try {
          // Try to use decode() method if available
          if ("decode" in img) {
            await img.decode();
          }

          resolve({ fallbackImage: img });
        } catch (decodeError) {
          // Decode failed, but image loaded - continue anyway
          console.warn(
            "Image decode failed but loading succeeded:",
            decodeError,
          );
          resolve({ fallbackImage: img });
        }
      };

      img.onerror = (error) => {
        reject(new Error("Failed to load image: " + error));
      };

      // Set optimized loading attributes
      img.loading = "lazy";
      img.decoding = "async";
      img.crossOrigin = "anonymous";
      img.src = processedImageUrl;
    });
  }

  /**
   * Create an HTMLImageElement from decoded result
   */
  createImageFromResult(
    result: DecodedImageResult,
    originalUrl: string,
  ): HTMLImageElement {
    const img = new Image();
    img.crossOrigin = "anonymous";

    if (result.imageBitmap) {
      // Convert ImageBitmap to canvas and then to data URL
      const canvas = document.createElement("canvas");
      canvas.width = result.imageBitmap.width;
      canvas.height = result.imageBitmap.height;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(result.imageBitmap, 0, 0);
        img.src = canvas.toDataURL();

        // Clean up ImageBitmap
        result.imageBitmap.close();
      } else {
        img.src = originalUrl;
      }
    } else if (result.canvas) {
      img.src = result.canvas.toDataURL();
    } else if (result.fallbackImage) {
      return result.fallbackImage;
    } else {
      img.src = originalUrl;
    }

    return img;
  }

  /**
   * Check if Web Worker is available and initialized
   */
  isWorkerAvailable(): boolean {
    return this.worker !== null && this.workerInitialized;
  }

  /**
   * Get statistics about the service
   */
  getStats() {
    return {
      workerAvailable: this.isWorkerAvailable(),
      pendingRequests: this.pendingRequests.size,
      supportsCreateImageBitmap: typeof createImageBitmap !== "undefined",
    };
  }

  /**
   * Terminate the worker and clean up resources
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerInitialized = false;
    }

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error("Service terminated"));
    }
    this.pendingRequests.clear();
  }
}

// Export singleton instance
export const imageDecoderService = new ImageDecoderService();

// Export types for use in other modules
export type { DecodedImageResult, ImageBitmapOptions };
