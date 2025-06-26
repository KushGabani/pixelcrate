import React, { useEffect } from "react";
import { m as motion, AnimatePresence } from "framer-motion";
import { ExternalLink, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateChecker } from "@/services/updateService";
import { useToast } from "@/components/ui/use-toast";
import { useReducedMotion, createSlideVariants } from "@/lib/motion";

interface UpdateNotificationProps {
  className?: string;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  className = "",
}) => {
  const { updateAvailable, checking } = useUpdateChecker();
  const [dismissed, setDismissed] = React.useState(false);
  const isElectron = window && typeof window.electron !== "undefined";
  const { toast } = useToast();

  // Handle manual update check completion
  useEffect(() => {
    if (isElectron && window.electron?.onManualUpdateCheckCompleted) {
      const unsubscribe = window.electron.onManualUpdateCheckCompleted(() => {
        // Only show the toast if there's no update available
        if (!updateAvailable) {
          toast({
            title: "No Updates Available",
            description: "You're running the latest version of PixelCrate.",
            duration: 3000,
          });
        }
      });

      return unsubscribe;
    }
  }, [isElectron, updateAvailable, toast]);

  const handleOpenReleasePage = () => {
    // Use Electron's shell to open external links if in Electron context
    if (isElectron && window.electron?.openUrl) {
      window.electron.openUrl(updateAvailable.html_url);
    } else {
      // Fallback for browser environment
      window.open(updateAvailable.html_url, "_blank");
    }
  };

  // Use reduced motion hook
  const prefersReducedMotion = useReducedMotion();

  // Don't render if there's no update available or if dismissed
  if (!updateAvailable || dismissed) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        {...createSlideVariants(prefersReducedMotion, "up", 50)}
        className={`fixed bottom-4 right-4 z-50 max-w-sm bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700 overflow-hidden ${className}`}
        style={{
          // Force GPU acceleration
          transform: "translate3d(0, 0, 0)",
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
        }}
      >
        <div className="p-4">
          <div className="flex justify-between items-start">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Update Available: {updateAvailable.name}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full -mt-1 -mr-1"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            A new version has been released. Check out what's new!
          </p>

          <div className="mt-4 flex space-x-2">
            <Button
              variant="default"
              size="sm"
              className="flex items-center space-x-1"
              onClick={handleOpenReleasePage}
            >
              <Download className="h-4 w-4" />
              <span>Get Update</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="flex items-center space-x-1"
              onClick={handleOpenReleasePage}
            >
              <ExternalLink className="h-4 w-4" />
              <span>Release Notes</span>
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default UpdateNotification;
