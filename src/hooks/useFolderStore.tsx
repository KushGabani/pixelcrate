import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { ImageItem } from "./useImageStore";

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  isSmartFolder?: boolean;
  smartFolderRule?: SmartFolderRule;
  autoTagRules?: AutoTagRule[];
}

export interface SmartFolderRule {
  type: 'date' | 'pattern' | 'tag' | 'untagged' | 'uncategorized';
  criteria?: {
    dateRange?: { days: number };
    patterns?: string[];
    tags?: string[];
  };
}

export interface AutoTagRule {
  condition: string;
  tags: string[];
}

export interface FolderStats {
  itemCount: number;
  totalSize: number;
  lastModified?: Date;
}

export interface UseFolderStoreReturn {
  folders: Folder[];
  isLoading: boolean;
  folderStats: Map<string, FolderStats>;
  createFolder: (name: string, parentId?: string, color?: string) => Promise<Folder | null>;
  updateFolder: (id: string, updates: Partial<Folder>) => Promise<boolean>;
  deleteFolder: (id: string) => Promise<boolean>;
  moveFolder: (folderId: string, newParentId?: string) => Promise<boolean>;
  getFolderPath: (folderId: string) => string[];
  getFolderChildren: (parentId?: string) => Folder[];
  getSmartFolderItems: (folderId: string, allImages: ImageItem[]) => ImageItem[];
  addImageToFolder: (imageId: string, folderId: string) => Promise<boolean>;
  removeImageFromFolder: (imageId: string) => Promise<boolean>;
  moveImageToFolder: (imageId: string, folderId: string) => Promise<boolean>;
  getFolderImages: (folderId: string, allImages: ImageItem[]) => ImageItem[];
  refreshFolderStats: () => Promise<void>;
}

// Smart folders are now removed - only user-created folders are managed

export function useFolderStore(): UseFolderStoreReturn {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [folderStats, setFolderStats] = useState<Map<string, FolderStats>>(new Map());

  // Load folders on mount
  useEffect(() => {
    const loadFolders = async () => {
      try {
        setIsLoading(true);

        // Load user-created folders from storage (no smart folders)
        const loadedFolders = await window.electron?.loadFolders?.() || [];
        setFolders(loadedFolders);

        // Load folder statistics
        await refreshFolderStats();
      } catch (error) {
        console.error("Error loading folders:", error);
        toast.error("Failed to load folders");
        // Fall back to empty folders array
        setFolders([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadFolders();
  }, []);

  const refreshFolderStats = useCallback(async () => {
    try {
      const stats = await window.electron?.getFolderStats?.() || {};
      const statsMap = new Map();
      Object.entries(stats).forEach(([id, stat]) => {
        statsMap.set(id, stat as FolderStats);
      });
      setFolderStats(statsMap);
    } catch (error) {
      console.error("Error loading folder stats:", error);
    }
  }, []);

  const createFolder = useCallback(async (name: string, parentId?: string, color?: string): Promise<Folder | null> => {
    try {
      const newFolder: Folder = {
        id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name,
        parentId,
        color,
        createdAt: new Date(),
        updatedAt: new Date(),
        isSmartFolder: false
      };

      // Save to storage via IPC
      const savedFolder = await window.electron?.createFolder?.(newFolder);
      if (!savedFolder) {
        throw new Error('Failed to create folder');
      }

      setFolders(prev => [...prev, savedFolder]);
      toast.success(`Folder "${name}" created`);
      return savedFolder;
    } catch (error) {
      console.error("Failed to create folder:", error);
      toast.error("Failed to create folder");
      return null;
    }
  }, []);

  const updateFolder = useCallback(async (id: string, updates: Partial<Folder>): Promise<boolean> => {
    try {
      const updatedFolder = await window.electron?.updateFolder?.(id, {
        ...updates,
        updatedAt: new Date()
      });

      if (!updatedFolder) {
        throw new Error('Failed to update folder');
      }

      setFolders(prev => prev.map(folder =>
        folder.id === id ? { ...folder, ...updatedFolder } : folder
      ));

      toast.success("Folder updated");
      return true;
    } catch (error) {
      console.error("Failed to update folder:", error);
      toast.error("Failed to update folder");
      return false;
    }
  }, []);

  const deleteFolder = useCallback(async (id: string): Promise<boolean> => {
    try {
      // Find the folder to delete
      const folder = folders.find(f => f.id === id);
      if (!folder) {
        toast.error("Folder not found");
        return false;
      }

      // Check if folder has children
      const hasChildren = folders.some(f => f.parentId === id);
      if (hasChildren) {
        toast.error("Cannot delete folder with subfolders");
        return false;
      }

      const success = await window.electron?.deleteFolder?.(id);
      if (!success) {
        throw new Error('Failed to delete folder');
      }

      setFolders(prev => prev.filter(folder => folder.id !== id));
      toast.success("Folder deleted");
      return true;
    } catch (error) {
      console.error("Failed to delete folder:", error);
      toast.error("Failed to delete folder");
      return false;
    }
  }, [folders]);

  const moveFolder = useCallback(async (folderId: string, newParentId?: string): Promise<boolean> => {
    try {
      // Prevent moving folder into itself or its descendants
      if (newParentId) {
        const wouldCreateCycle = (checkId: string): boolean => {
          if (checkId === folderId) return true;
          const parent = folders.find(f => f.id === checkId)?.parentId;
          return parent ? wouldCreateCycle(parent) : false;
        };

        if (wouldCreateCycle(newParentId)) {
          toast.error("Cannot move folder into itself or its subfolder");
          return false;
        }
      }

      const success = await window.electron?.moveFolder?.(folderId, newParentId);
      if (!success) {
        throw new Error('Failed to move folder');
      }

      setFolders(prev => prev.map(folder =>
        folder.id === folderId
          ? { ...folder, parentId: newParentId, updatedAt: new Date() }
          : folder
      ));

      return true;
    } catch (error) {
      console.error("Failed to move folder:", error);
      toast.error("Failed to move folder");
      return false;
    }
  }, [folders]);

  const getFolderPath = useCallback((folderId: string): string[] => {
    const path: string[] = [];
    let currentId: string | undefined = folderId;

    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (!folder) break;
      path.unshift(folder.name);
      currentId = folder.parentId;
    }

    return path;
  }, [folders]);

  const getFolderChildren = useCallback((parentId?: string): Folder[] => {
    return folders.filter(folder => folder.parentId === parentId);
  }, [folders]);

  const getSmartFolderItems = useCallback((folderId: string, allImages: ImageItem[]): ImageItem[] => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder?.isSmartFolder || !folder.smartFolderRule) {
      return [];
    }

    const rule = folder.smartFolderRule;

    switch (rule.type) {
      case 'date':
        if (rule.criteria?.dateRange) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - rule.criteria.dateRange.days);
          return allImages.filter(img => new Date(img.createdAt) >= cutoffDate);
        }
        break;
      case 'untagged':
        return allImages.filter(img => !img.patterns || img.patterns.length === 0);
      case 'uncategorized':
        // Images not assigned to any user folder
        return allImages.filter(img => {
          // This would need to check folder assignments in metadata
          return true; // Placeholder
        });
      case 'pattern':
        if (rule.criteria?.patterns) {
          return allImages.filter(img =>
            img.patterns?.some(pattern =>
              rule.criteria!.patterns!.some(rulePattern =>
                pattern.name.toLowerCase().includes(rulePattern.toLowerCase())
              )
            )
          );
        }
        break;
    }

    return [];
  }, [folders]);

  const addImageToFolder = useCallback(async (imageId: string, folderId: string): Promise<boolean> => {
    try {
      const success = await window.electron?.addImageToFolder?.(imageId, folderId);
      if (!success) {
        throw new Error('Failed to add image to folder');
      }

      await refreshFolderStats();
      return true;
    } catch (error) {
      console.error("Failed to add image to folder:", error);
      toast.error("Failed to add image to folder");
      return false;
    }
  }, [refreshFolderStats]);

  const removeImageFromFolder = useCallback(async (imageId: string): Promise<boolean> => {
    try {
      const success = await window.electron?.removeImageFromFolder?.(imageId);
      if (!success) {
        throw new Error('Failed to remove image from folder');
      }

      await refreshFolderStats();
      return true;
    } catch (error) {
      console.error("Failed to remove image from folder:", error);
      toast.error("Failed to remove image from folder");
      return false;
    }
  }, [refreshFolderStats]);

  const moveImageToFolder = useCallback(async (imageId: string, folderId: string): Promise<boolean> => {
    try {
      const success = await window.electron?.moveImageToFolder?.(imageId, folderId);
      if (!success) {
        throw new Error('Failed to move image to folder');
      }

      await refreshFolderStats();
      return true;
    } catch (error) {
      console.error("Failed to move image to folder:", error);
      toast.error("Failed to move image to folder");
      return false;
    }
  }, [refreshFolderStats]);

  const getFolderImages = useCallback((folderId: string, allImages: ImageItem[]): ImageItem[] => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return [];

    if (folder.isSmartFolder) {
      return getSmartFolderItems(folderId, allImages);
    }

    // For regular folders, filter images that belong to this folder
    // This would need to check folder assignments in image metadata
    return allImages.filter(img => {
      // Placeholder: would check img.folderId === folderId
      return false;
    });
  }, [folders, getSmartFolderItems]);

  return {
    folders,
    isLoading,
    folderStats,
    createFolder,
    updateFolder,
    deleteFolder,
    moveFolder,
    getFolderPath,
    getFolderChildren,
    getSmartFolderItems,
    addImageToFolder,
    removeImageFromFolder,
    moveImageToFolder,
    getFolderImages,
    refreshFolderStats,
  };
}
