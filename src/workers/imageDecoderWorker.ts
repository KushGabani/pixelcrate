/**
 * Image Decoder Web Worker
 * 
 * This worker handles image decoding off the main thread to prevent blocking.
 * Uses createImageBitmap for efficient async decoding where supported.
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

// Check if createImageBitmap is supported
const supportsCreateImageBitmap = typeof createImageBitmap !== 'undefined';

self.onmessage = async function(event: MessageEvent<ImageDecodeRequest>) {
  const { id, imageUrl, options = {} } = event.data;
  
  try {
    if (supportsCreateImageBitmap) {
      // Use createImageBitmap for modern browsers
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      
      // Use createImageBitmap with options for optimal decoding
      const imageBitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'default',
        colorSpaceConversion: 'default',
        resizeQuality: 'high',
        ...options
      });
      
      const workerResponse: ImageDecodeResponse = {
        id,
        success: true,
        imageBitmap
      };
      
      // Transfer the ImageBitmap to avoid copying
      self.postMessage(workerResponse, [imageBitmap]);
      
    } else {
      // Fallback for browsers without createImageBitmap support
      // This still runs off-main-thread but uses traditional Image loading
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      // Create a blob URL for the image
      const blob = new Blob([arrayBuffer]);
      const blobUrl = URL.createObjectURL(blob);
      
      // Load the image using traditional method
      const img = new Image();
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error('Failed to load image'));
        };
        img.src = blobUrl;
      });
      
      // Create canvas to extract image data
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }
      
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      
      const fallbackResponse: ImageDecodeResponse = {
        id,
        success: true,
        fallbackImageData: {
          width: img.width,
          height: img.height,
          data: imageData.data.buffer
        }
      };
      
      self.postMessage(fallbackResponse, [imageData.data.buffer]);
    }
    
  } catch (error) {
    const errorResponse: ImageDecodeResponse = {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    self.postMessage(errorResponse);
  }
};

// Handle worker termination gracefully
self.onclose = function() {
  // Clean up any resources if needed
  console.log('Image decoder worker terminated');
};

export {};
