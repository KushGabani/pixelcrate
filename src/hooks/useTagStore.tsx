import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { ImageItem, PatternTag } from "./useImageStore";

export interface Tag {
  id: string;
  name: string;
  color: string;
  parentId?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  isAutoTag?: boolean;
  autoTagRule?: AutoTagRule;
  usage: number;
}

export interface AutoTagRule {
  type: 'pattern' | 'filename' | 'metadata' | 'ai';
  criteria: {
    patterns?: string[];
    filenameContains?: string[];
    aiConfidenceThreshold?: number;
    aiPatterns?: string[];
  };
}

export interface TagStats {
  usage: number;
  lastUsed?: Date;
  imageCount: number;
  averageConfidence?: number;
}

export interface BulkTagOperation {
  type: 'add' | 'remove' | 'replace';
  imageIds: string[];
  tagIds: string[];
}

export interface UseTagStoreReturn {
  tags: Tag[];
  isLoading: boolean;
  tagStats: Map<string, TagStats>;
  createTag: (name: string, color?: string, parentId?: string) => Promise<Tag | null>;
  updateTag: (id: string, updates: Partial<Tag>) => Promise<boolean>;
  deleteTag: (id: string, moveToParent?: boolean) => Promise<boolean>;
  moveTag: (tagId: string, newParentId?: string) => Promise<boolean>;
  getTagPath: (tagId: string) => string[];
  getTagChildren: (parentId?: string) => Tag[];
  addTagToImage: (imageId: string, tagId: string, confidence?: number) => Promise<boolean>;
  removeTagFromImage: (imageId: string, tagId: string) => Promise<boolean>;
  bulkTagOperation: (operation: BulkTagOperation) => Promise<boolean>;
  searchTags: (query: string) => Tag[];
  getImageTags: (imageId: string) => Tag[];
  getMostUsedTags: (limit?: number) => Tag[];
  getUnusedTags: () => Tag[];
  autoTagImages: (imageIds: string[], allImages: ImageItem[]) => Promise<boolean>;
  exportTags: () => Promise<string | null>;
  importTags: (tagsData: string) => Promise<boolean>;
  refreshTagStats: () => Promise<void>;
  mergeTagsByName: (tagNames: string[], targetTagId: string) => Promise<boolean>;
}

const DEFAULT_TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
  '#78716c', // stone
];

const getRandomColor = (): string => {
  return DEFAULT_TAG_COLORS[Math.floor(Math.random() * DEFAULT_TAG_COLORS.length)];
};

export function useTagStore(): UseTagStoreReturn {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tagStats, setTagStats] = useState<Map<string, TagStats>>(new Map());

  // Load tags on mount
  useEffect(() => {
    const loadTags = async () => {
      try {
        setIsLoading(true);

        const loadedTags = await window.electron?.loadTags?.() || [];
        setTags(loadedTags);

        await refreshTagStats();
      } catch (error) {
        console.error("Error loading tags:", error);
        toast.error("Failed to load tags");
      } finally {
        setIsLoading(false);
      }
    };

    loadTags();
  }, []);

  const refreshTagStats = useCallback(async () => {
    try {
      const stats = await window.electron?.getTagStats?.() || {};
      const statsMap = new Map();
      Object.entries(stats).forEach(([id, stat]) => {
        statsMap.set(id, stat as TagStats);
      });
      setTagStats(statsMap);
    } catch (error) {
      console.error("Error loading tag stats:", error);
    }
  }, []);

  const createTag = useCallback(async (name: string, color?: string, parentId?: string): Promise<Tag | null> => {
    try {
      // Check for duplicate names
      const existingTag = tags.find(tag =>
        tag.name.toLowerCase() === name.toLowerCase() && tag.parentId === parentId
      );
      if (existingTag) {
        toast.error("Tag with this name already exists");
        return null;
      }

      const newTag: Tag = {
        id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        color: color || getRandomColor(),
        parentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAutoTag: false,
        usage: 0
      };

      const savedTag = await window.electron?.createTag?.(newTag);
      if (!savedTag) {
        throw new Error('Failed to create tag');
      }

      setTags(prev => [...prev, savedTag]);
      toast.success(`Tag "${name}" created`);
      return savedTag;
    } catch (error) {
      console.error("Failed to create tag:", error);
      toast.error("Failed to create tag");
      return null;
    }
  }, [tags]);

  const updateTag = useCallback(async (id: string, updates: Partial<Tag>): Promise<boolean> => {
    try {
      const updatedTag = await window.electron?.updateTag?.(id, {
        ...updates,
        updatedAt: new Date()
      });

      if (!updatedTag) {
        throw new Error('Failed to update tag');
      }

      setTags(prev => prev.map(tag =>
        tag.id === id ? { ...tag, ...updatedTag } : tag
      ));

      toast.success("Tag updated");
      return true;
    } catch (error) {
      console.error("Failed to update tag:", error);
      toast.error("Failed to update tag");
      return false;
    }
  }, []);

  const deleteTag = useCallback(async (id: string, moveToParent: boolean = false): Promise<boolean> => {
    try {
      const tag = tags.find(t => t.id === id);
      if (!tag) {
        toast.error("Tag not found");
        return false;
      }

      // Check if tag has children
      const children = tags.filter(t => t.parentId === id);
      if (children.length > 0 && !moveToParent) {
        toast.error("Cannot delete tag with children. Move children first or use move to parent option.");
        return false;
      }

      const success = await window.electron?.deleteTag?.(id, moveToParent);
      if (!success) {
        throw new Error('Failed to delete tag');
      }

      // Update local state
      setTags(prev => {
        let newTags = prev.filter(tag => tag.id !== id);

        // If moving children to parent, update their parentId
        if (moveToParent) {
          newTags = newTags.map(tag =>
            tag.parentId === id
              ? { ...tag, parentId: tag.parentId, updatedAt: new Date() }
              : tag
          );
        }

        return newTags;
      });

      toast.success("Tag deleted");
      return true;
    } catch (error) {
      console.error("Failed to delete tag:", error);
      toast.error("Failed to delete tag");
      return false;
    }
  }, [tags]);

  const moveTag = useCallback(async (tagId: string, newParentId?: string): Promise<boolean> => {
    try {
      // Prevent moving tag into itself or its descendants
      if (newParentId) {
        const wouldCreateCycle = (checkId: string): boolean => {
          if (checkId === tagId) return true;
          const parent = tags.find(t => t.id === checkId)?.parentId;
          return parent ? wouldCreateCycle(parent) : false;
        };

        if (wouldCreateCycle(newParentId)) {
          toast.error("Cannot move tag into itself or its subtag");
          return false;
        }
      }

      const success = await window.electron?.moveTag?.(tagId, newParentId);
      if (!success) {
        throw new Error('Failed to move tag');
      }

      setTags(prev => prev.map(tag =>
        tag.id === tagId
          ? { ...tag, parentId: newParentId, updatedAt: new Date() }
          : tag
      ));

      return true;
    } catch (error) {
      console.error("Failed to move tag:", error);
      toast.error("Failed to move tag");
      return false;
    }
  }, [tags]);

  const getTagPath = useCallback((tagId: string): string[] => {
    const path: string[] = [];
    let currentId: string | undefined = tagId;

    while (currentId) {
      const tag = tags.find(t => t.id === currentId);
      if (!tag) break;
      path.unshift(tag.name);
      currentId = tag.parentId;
    }

    return path;
  }, [tags]);

  const getTagChildren = useCallback((parentId?: string): Tag[] => {
    return tags.filter(tag => tag.parentId === parentId);
  }, [tags]);

  const addTagToImage = useCallback(async (imageId: string, tagId: string, confidence: number = 1.0): Promise<boolean> => {
    try {
      const success = await window.electron?.addTagToImage?.(imageId, tagId, confidence);
      if (!success) {
        throw new Error('Failed to add tag to image');
      }

      // Update tag usage
      setTags(prev => prev.map(tag =>
        tag.id === tagId
          ? { ...tag, usage: tag.usage + 1, updatedAt: new Date() }
          : tag
      ));

      await refreshTagStats();
      return true;
    } catch (error) {
      console.error("Failed to add tag to image:", error);
      toast.error("Failed to add tag to image");
      return false;
    }
  }, [refreshTagStats]);

  const removeTagFromImage = useCallback(async (imageId: string, tagId: string): Promise<boolean> => {
    try {
      const success = await window.electron?.removeTagFromImage?.(imageId, tagId);
      if (!success) {
        throw new Error('Failed to remove tag from image');
      }

      // Update tag usage
      setTags(prev => prev.map(tag =>
        tag.id === tagId
          ? { ...tag, usage: Math.max(0, tag.usage - 1), updatedAt: new Date() }
          : tag
      ));

      await refreshTagStats();
      return true;
    } catch (error) {
      console.error("Failed to remove tag from image:", error);
      toast.error("Failed to remove tag from image");
      return false;
    }
  }, [refreshTagStats]);

  const bulkTagOperation = useCallback(async (operation: BulkTagOperation): Promise<boolean> => {
    try {
      const success = await window.electron?.bulkTagOperation?.(operation);
      if (!success) {
        throw new Error('Failed to perform bulk tag operation');
      }

      // Update tag usage for affected tags
      const usageChange = operation.type === 'add' ? operation.imageIds.length :
                         operation.type === 'remove' ? -operation.imageIds.length : 0;

      if (usageChange !== 0) {
        setTags(prev => prev.map(tag =>
          operation.tagIds.includes(tag.id)
            ? { ...tag, usage: Math.max(0, tag.usage + usageChange), updatedAt: new Date() }
            : tag
        ));
      }

      await refreshTagStats();
      toast.success(`Bulk ${operation.type} operation completed`);
      return true;
    } catch (error) {
      console.error("Failed to perform bulk tag operation:", error);
      toast.error("Failed to perform bulk tag operation");
      return false;
    }
  }, [refreshTagStats]);

  const searchTags = useCallback((query: string): Tag[] => {
    if (!query.trim()) return tags;

    const searchTerm = query.toLowerCase();
    return tags.filter(tag =>
      tag.name.toLowerCase().includes(searchTerm) ||
      tag.description?.toLowerCase().includes(searchTerm)
    );
  }, [tags]);

  const getImageTags = useCallback((imageId: string): Tag[] => {
    // This would need to be implemented with actual image-tag relationships
    // For now, return empty array as placeholder
    return [];
  }, []);

  const getMostUsedTags = useCallback((limit: number = 10): Tag[] => {
    return [...tags]
      .sort((a, b) => b.usage - a.usage)
      .slice(0, limit);
  }, [tags]);

  const getUnusedTags = useCallback((): Tag[] => {
    return tags.filter(tag => tag.usage === 0);
  }, [tags]);

  const autoTagImages = useCallback(async (imageIds: string[], allImages: ImageItem[]): Promise<boolean> => {
    try {
      const autoTagRules = tags.filter(tag => tag.isAutoTag && tag.autoTagRule);
      if (autoTagRules.length === 0) {
        toast.info("No auto-tag rules configured");
        return true;
      }

      let successCount = 0;

      for (const imageId of imageIds) {
        const image = allImages.find(img => img.id === imageId);
        if (!image) continue;

        for (const tag of autoTagRules) {
          const rule = tag.autoTagRule!;
          let shouldTag = false;

          switch (rule.type) {
            case 'pattern':
              if (rule.criteria.patterns && image.patterns) {
                shouldTag = image.patterns.some(pattern =>
                  rule.criteria.patterns!.some(rulePattern =>
                    pattern.name.toLowerCase().includes(rulePattern.toLowerCase())
                  )
                );
              }
              break;
            case 'ai':
              if (rule.criteria.aiPatterns && rule.criteria.aiConfidenceThreshold && image.patterns) {
                shouldTag = image.patterns.some(pattern =>
                  rule.criteria.aiPatterns!.some(aiPattern =>
                    pattern.name.toLowerCase().includes(aiPattern.toLowerCase())
                  ) && pattern.confidence >= rule.criteria.aiConfidenceThreshold!
                );
              }
              break;
            case 'filename':
              // Would need access to original filename
              break;
          }

          if (shouldTag) {
            await addTagToImage(imageId, tag.id, 0.8); // Auto-tag confidence
            successCount++;
          }
        }
      }

      if (successCount > 0) {
        toast.success(`Auto-tagged ${successCount} images`);
      }
      return true;
    } catch (error) {
      console.error("Failed to auto-tag images:", error);
      toast.error("Failed to auto-tag images");
      return false;
    }
  }, [tags, addTagToImage]);

  const exportTags = useCallback(async (): Promise<string | null> => {
    try {
      const exportData = {
        tags: tags,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error("Failed to export tags:", error);
      toast.error("Failed to export tags");
      return null;
    }
  }, [tags]);

  const importTags = useCallback(async (tagsData: string): Promise<boolean> => {
    try {
      const importData = JSON.parse(tagsData);

      if (!importData.tags || !Array.isArray(importData.tags)) {
        throw new Error('Invalid tags data format');
      }

      const success = await window.electron?.importTags?.(importData.tags);
      if (!success) {
        throw new Error('Failed to import tags');
      }

      // Reload tags from storage
      const loadedTags = await window.electron?.loadTags?.() || [];
      setTags(loadedTags);

      toast.success("Tags imported successfully");
      return true;
    } catch (error) {
      console.error("Failed to import tags:", error);
      toast.error("Failed to import tags");
      return false;
    }
  }, []);

  const mergeTagsByName = useCallback(async (tagNames: string[], targetTagId: string): Promise<boolean> => {
    try {
      const tagsToMerge = tags.filter(tag =>
        tagNames.includes(tag.name) && tag.id !== targetTagId
      );

      if (tagsToMerge.length === 0) {
        toast.error("No tags found to merge");
        return false;
      }

      const success = await window.electron?.mergeTags?.(
        tagsToMerge.map(tag => tag.id),
        targetTagId
      );

      if (!success) {
        throw new Error('Failed to merge tags');
      }

      // Remove merged tags and update target tag usage
      const targetTag = tags.find(tag => tag.id === targetTagId);
      if (targetTag) {
        const totalUsage = tagsToMerge.reduce((sum, tag) => sum + tag.usage, 0);

        setTags(prev => prev
          .filter(tag => !tagsToMerge.some(merged => merged.id === tag.id))
          .map(tag => tag.id === targetTagId
            ? { ...tag, usage: tag.usage + totalUsage, updatedAt: new Date() }
            : tag
          )
        );
      }

      toast.success(`Merged ${tagsToMerge.length} tags`);
      return true;
    } catch (error) {
      console.error("Failed to merge tags:", error);
      toast.error("Failed to merge tags");
      return false;
    }
  }, [tags]);

  return {
    tags,
    isLoading,
    tagStats,
    createTag,
    updateTag,
    deleteTag,
    moveTag,
    getTagPath,
    getTagChildren,
    addTagToImage,
    removeTagFromImage,
    bulkTagOperation,
    searchTags,
    getImageTags,
    getMostUsedTags,
    getUnusedTags,
    autoTagImages,
    exportTags,
    importTags,
    refreshTagStats,
    mergeTagsByName,
  };
}
