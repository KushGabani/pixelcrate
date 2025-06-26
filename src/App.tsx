import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useEffect } from "react";
import { initializeAnalytics, sendAnalyticsEvent } from "@/services/analyticsService";
import UpdateNotification from "@/components/UpdateNotification";
import { ActiveFolderProvider } from "@/contexts/ActiveFolderContext";
import { MotionProvider } from "@/lib/motion";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import "@/components/gpu-acceleration.css";
import "@/styles/reduced-motion.css";

// Import image decoder tests for development
if (process.env.NODE_ENV === 'development') {
  import('./utils/imageDecoderTest');
}

const queryClient = new QueryClient();

// Use HashRouter for Electron compatibility
const App = () => {
  const isElectron = window && typeof window.electron !== 'undefined';
  
  // Initialize analytics on app startup
  useEffect(() => {
    const setupAnalytics = async () => {
      try {
        await initializeAnalytics();
        
        // Single app-ready event after initialization
        setTimeout(async () => {
          try {
            // Get the number of files if running in Electron
            let fileCount = 0;
            if (isElectron && window.electron?.loadImages) {
              try {
                const loadedImages = await window.electron.loadImages();
                fileCount = Array.isArray(loadedImages) ? loadedImages.length : 0;
              } catch (countError) {
                console.error("Error counting files:", countError);
              }
            }
            
            sendAnalyticsEvent('app-ready', { 
              floatValue: Date.now() / 1000,
              startupTime: new Date().toISOString(),
              isElectron: isElectron ? 'true' : 'false',
              fileCount: fileCount
            });
          } catch (analyticsError) {
            // Silent error in production
          }
        }, 2000);
      } catch (error) {
        // Silent error in production
      }
    };
    
    setupAnalytics();
  }, [isElectron]);
  
return (
    <MotionProvider>
      <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
        <QueryClientProvider client={queryClient}>
          <ActiveFolderProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <UpdateNotification />
              {/* Use HashRouter for better Electron compatibility */}
              <HashRouter>
                <Routes>
                  <Route path="/" element={<Index />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </HashRouter>
            </TooltipProvider>
          </ActiveFolderProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </MotionProvider>
  );
};

export default App;
