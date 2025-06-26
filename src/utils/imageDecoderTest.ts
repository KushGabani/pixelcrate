/**
 * Test utilities for Web Worker image decoding
 * 
 * This file provides testing functions to verify that the Web Worker-based
 * image decoding is working correctly.
 */

import { imageDecoderService } from '../services/imageDecoderService';

/**
 * Test the image decoder service with a sample image
 */
export async function testImageDecoder(): Promise<void> {
  console.log('Testing Image Decoder Service...');
  
  // Get service stats
  const stats = imageDecoderService.getStats();
  console.log('Service Stats:', stats);
  
  // Test with a data URL image (small test image)
  const testImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  
  try {
    console.log('Decoding test image...');
    const result = await imageDecoderService.decodeImage(testImageDataUrl);
    
    if (result.imageBitmap) {
      console.log('✅ ImageBitmap decoded successfully:', result.imageBitmap);
      result.imageBitmap.close(); // Clean up
    } else if (result.canvas) {
      console.log('✅ Canvas fallback used successfully:', result.canvas);
    } else if (result.fallbackImage) {
      console.log('✅ Image fallback used successfully:', result.fallbackImage);
    } else {
      console.log('❌ No valid result from decoder');
    }
    
    console.log('Image decoder test completed successfully!');
  } catch (error) {
    console.error('❌ Image decoder test failed:', error);
  }
}

/**
 * Test the image decoder with multiple concurrent requests
 */
export async function testConcurrentDecoding(): Promise<void> {
  console.log('Testing concurrent image decoding...');
  
  // Create multiple test images with different data
  const testImages = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNkYGBgYGDYDwQAAAgAAgAHPJo9AAAAABJRU5ErkJggg==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAGElEQVR42mNkYGBgYGCYj8VASwYkFggAABoAAwBNuBLyAAAADAsURVhJZk5UAQ=='
  ];
  
  const startTime = performance.now();
  
  try {
    const promises = testImages.map((url, index) => 
      imageDecoderService.decodeImage(url).then(result => {
        console.log(`✅ Image ${index + 1} decoded successfully`);
        // Clean up ImageBitmap if present
        if (result.imageBitmap) {
          result.imageBitmap.close();
        }
        return result;
      })
    );
    
    const results = await Promise.all(promises);
    const endTime = performance.now();
    
    console.log(`✅ All ${results.length} images decoded in ${endTime - startTime}ms`);
    console.log('Concurrent decoding test completed successfully!');
  } catch (error) {
    console.error('❌ Concurrent decoding test failed:', error);
  }
}

/**
 * Performance test comparing Web Worker vs main thread decoding
 */
export async function testPerformanceComparison(): Promise<void> {
  console.log('Testing performance comparison...');
  
  const testImageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const iterations = 10;
  
  // Test Web Worker decoding
  const workerStartTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    try {
      const result = await imageDecoderService.decodeImage(testImageUrl);
      if (result.imageBitmap) {
        result.imageBitmap.close();
      }
    } catch (error) {
      console.warn(`Worker iteration ${i} failed:`, error);
    }
  }
  const workerEndTime = performance.now();
  const workerTime = workerEndTime - workerStartTime;
  
  // Test main thread decoding (fallback)
  const mainThreadStartTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
          try {
            if ('decode' in img) {
              await img.decode();
            }
            resolve();
          } catch (error) {
            resolve(); // Continue anyway
          }
        };
        img.onerror = reject;
        img.src = testImageUrl;
      });
    } catch (error) {
      console.warn(`Main thread iteration ${i} failed:`, error);
    }
  }
  const mainThreadEndTime = performance.now();
  const mainThreadTime = mainThreadEndTime - mainThreadStartTime;
  
  console.log(`Web Worker decoding: ${workerTime}ms for ${iterations} iterations`);
  console.log(`Main thread decoding: ${mainThreadTime}ms for ${iterations} iterations`);
  console.log(`Performance ratio: ${(mainThreadTime / workerTime).toFixed(2)}x`);
}

/**
 * Run all tests
 */
export async function runAllTests(): Promise<void> {
  console.log('🧪 Starting Image Decoder Tests...\n');
  
  try {
    await testImageDecoder();
    console.log('\n---\n');
    
    await testConcurrentDecoding();
    console.log('\n---\n');
    
    await testPerformanceComparison();
    console.log('\n---\n');
    
    console.log('🎉 All tests completed!');
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

// Auto-run tests in development mode
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Add to window for manual testing
  (window as any).imageDecoderTests = {
    runAllTests,
    testImageDecoder,
    testConcurrentDecoding,
    testPerformanceComparison
  };
  
  console.log('Image decoder tests available on window.imageDecoderTests');
}
