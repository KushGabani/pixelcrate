import React from 'react';
import { useActiveFolder } from '@/contexts/ActiveFolderContext';
import { Folder, FolderOpen } from 'lucide-react';

export function ActiveFolderIndicator() {
  const { activeFolder } = useActiveFolder();

  if (!activeFolder) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Folder className="h-4 w-4" />
          <span className="text-sm">No folder selected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-medium text-foreground">Active Folder:</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {activeFolder.name}
          </span>
          {activeFolder.isDefault && (
            <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
              Default
            </span>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Images will be saved here when dropped or pasted
      </div>
    </div>
  );
}
