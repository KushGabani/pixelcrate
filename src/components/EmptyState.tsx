import React from "react";
import { Upload, Image, Clipboard, FolderOpen } from "lucide-react";
import { useActiveFolder } from "@/contexts/ActiveFolderContext";

export function EmptyState() {
  const { activeFolder } = useActiveFolder();

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-6">
        {/* Icon Stack */}
        <div className="relative mx-auto w-24 h-24">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-purple-500/20 rounded-full blur-xl"></div>
          <div className="relative bg-background border-2 border-border rounded-full w-24 h-24 flex items-center justify-center">
            <Image className="h-10 w-10 text-muted-foreground" />
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">
            No images yet
          </h2>
          <p className="text-muted-foreground">
            Start building your collection by adding some images
          </p>
        </div>

        {/* Instructions */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <Upload className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-foreground">
                  Drag & Drop
                </div>
                <div className="text-xs text-muted-foreground">
                  Drop images anywhere on this page
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50">
              <div className="flex-shrink-0 w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                <Clipboard className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-foreground">
                  Paste from Clipboard
                </div>
                <div className="text-xs text-muted-foreground">
                  Use Cmd+V to paste copied images
                </div>
              </div>
            </div>
          </div>

          {/* Additional Tips */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>💡 Supported formats: PNG, JPG, GIF, WebP, MP4, WebM</p>
            <p>🎯 Use the sidebar to organize images into folders</p>
            {activeFolder && (
              <p>
                📁 Images will be saved to:{" "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {activeFolder.name}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
