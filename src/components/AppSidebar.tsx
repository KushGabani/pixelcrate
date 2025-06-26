import React, { useState, useEffect, useCallback } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarInput,
  SidebarProvider,
} from "./ui/sidebar";
import {
  Filter,
  Folder as FolderIcon,
  Plus,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFolderStore } from "@/hooks/useFolderStore";
import { useActiveFolder, ActiveFolder } from "@/contexts/ActiveFolderContext";

// File system folder interface
interface FileSystemFolder {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  children?: FileSystemFolder[];
  isDirectory: boolean;
}

export function AppSidebar() {
  // State for file system folders
  const [fileSystemFolders, setFileSystemFolders] = useState<
    FileSystemFolder[]
  >([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Get folder data from store for managed folders
  const {
    folders: managedFolders,
    folderStats,
    createFolder,
    deleteFolder,
    getFolderChildren,
  } = useFolderStore();

  // Get active folder context
  const { activeFolder, setActiveFolder, ensureDefaultFolder } =
    useActiveFolder();

  // Track open state of folders
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  // Function to load file system folders
  const loadFileSystemFolders = useCallback(async () => {
    if (!window.electron?.readDirectory || !window.electron?.getAppStorageDir) {
      // Fallback for web mode or if API not available
      console.warn("File system access not available");
      return;
    }

    setIsLoadingFolders(true);
    try {
      // Get app storage directory (~/Documents/PixelCrate/) from electron API
      const appStorageDir = await window.electron.getAppStorageDir();
      // Use the images subdirectory as the root for folder management
      const imagesDir = `${appStorageDir}/images`;
      const folders = await loadDirectoryStructure(imagesDir);
      setFileSystemFolders(folders);
    } catch (error) {
      console.error("Failed to load file system folders:", error);
      toast.error("Failed to load folders from file system");
    } finally {
      setIsLoadingFolders(false);
    }
  }, []);

  // Load file system folders on mount
  useEffect(() => {
    loadFileSystemFolders();
  }, [loadFileSystemFolders]);

  // Ensure default folder exists when component mounts
  useEffect(() => {
    const initializeDefault = async () => {
      try {
        await ensureDefaultFolder();
        // Reload folders to show the default folder
        await loadFileSystemFolders();
      } catch (error) {
        console.error("Failed to initialize default folder:", error);
      }
    };
    initializeDefault();
  }, [ensureDefaultFolder, loadFileSystemFolders]);

  // Function to load directory structure (only root level - no subfolders)
  const loadDirectoryStructure = async (
    path: string,
  ): Promise<FileSystemFolder[]> => {
    try {
      if (!window.electron?.readDirectory) return [];

      const entries = await window.electron.readDirectory(path);
      const folders: FileSystemFolder[] = [];

      for (const entry of entries) {
        if (entry.isDirectory) {
          const folder: FileSystemFolder = {
            id: `fs_${entry.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
            name: entry.name,
            path: entry.path,
            isDirectory: true,
          };
          folders.push(folder);
        }
      }

      return folders;
    } catch (error) {
      console.error(`Failed to load directory: ${path}`, error);
      return [];
    }
  };

  // Function to create a new directory
  const createFileSystemFolder = useCallback(
    async (name: string, parentPath: string) => {
      if (!window.electron?.createDirectory) {
        toast.error("Directory creation not supported");
        return;
      }

      try {
        const newPath = `${parentPath}/${name}`;
        const success = await window.electron.createDirectory(newPath);

        if (success) {
          toast.success(`Folder "${name}" created`);
          // Reload the folder structure
          await loadFileSystemFolders();
        } else {
          toast.error("Failed to create folder");
        }
      } catch (error) {
        console.error("Failed to create directory:", error);
        toast.error("Failed to create folder");
      }
    },
    [loadFileSystemFolders],
  );

  // Function to delete a directory
  const deleteFileSystemFolder = useCallback(
    async (folderPath: string) => {
      if (!window.electron?.deleteDirectory) {
        toast.error("Directory deletion not supported");
        return;
      }

      try {
        const success = await window.electron.deleteDirectory(folderPath);

        if (success) {
          toast.success("Folder deleted");
          // Reload the folder structure
          await loadFileSystemFolders();
        } else {
          toast.error("Failed to delete folder");
        }
      } catch (error) {
        console.error("Failed to delete directory:", error);
        toast.error("Failed to delete folder");
      }
    },
    [loadFileSystemFolders],
  );

  // State for folder creation dialog
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [currentParentPath, setCurrentParentPath] = useState<string>("");

  // State for delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<FileSystemFolder | null>(
    null,
  );

  // State for folder filter
  const [folderFilter, setFolderFilter] = useState("");

  // No longer needed - folders don't have subfolders

  // Handle folder creation
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error("Folder name cannot be empty");
      return;
    }

    await createFileSystemFolder(newFolderName.trim(), currentParentPath);
    setNewFolderName("");
    setShowCreateFolderDialog(false);
  };

  // Open create folder dialog
  const openCreateFolderDialog = async (parentPath?: string) => {
    if (!parentPath && window.electron?.getAppStorageDir) {
      try {
        const appStorageDir = await window.electron.getAppStorageDir();
        // Use the images subdirectory as the default parent path
        parentPath = `${appStorageDir}/images`;
      } catch (error) {
        console.error("Failed to get app storage directory:", error);
        parentPath = "";
      }
    }
    setCurrentParentPath(parentPath || "");
    setNewFolderName("");
    setShowCreateFolderDialog(true);
  };

  // Handle folder deletion
  const confirmDeleteFolder = (folder: FileSystemFolder) => {
    setFolderToDelete(folder);
    setShowDeleteDialog(true);
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;

    await deleteFileSystemFolder(folderToDelete.path);
    setShowDeleteDialog(false);
    setFolderToDelete(null);
  };

  // Function to handle folder selection
  const handleFolderSelect = useCallback(
    (folder: FileSystemFolder) => {
      const activeFolderData: ActiveFolder = {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        isDefault: folder.name === "Default",
      };
      setActiveFolder(activeFolderData);
    },
    [setActiveFolder],
  );

  // Filter file system folders by name
  const filteredFolders = folderFilter.trim()
    ? fileSystemFolders.filter((f) =>
        f.name.toLowerCase().includes(folderFilter.toLowerCase()),
      )
    : fileSystemFolders;

  // Get root folders (those without a parent)
  const rootFolders = filteredFolders.filter((folder) => !folder.parentId);

  return (
    <Sidebar>
      <SidebarHeader className="pt-8">
        <div className="flex items-center space-x-2">
          {/* Placeholder for the app icon, similar to the reference */}
          <svg
            className="h-7 w-7 text-emerald-500"
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM8.62061 8.35123C8.84439 7.55837 9.55726 7 10.4 7H13.6C15.0376 7 16.2 8.16244 16.2 9.6C16.2 10.6445 15.6318 11.5791 14.7508 12.0692C15.5422 12.4417 16 13.1593 16 14C16 15.1046 15.1046 16 14 16H10.5C9.67157 16 9 15.3284 9 14.5V14.5C9 13.6716 9.67157 13 10.5 13H13.5C14.3284 13 15 12.3284 15 11.5C15 10.6716 14.3284 10 13.5 10H10.4C9.55622 10 8.84274 9.44283 8.62061 8.64877L8.62061 8.35123Z"
            />
          </svg>
          <span className="font-semibold text-lg">PixelCrate</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center justify-between mb-1">
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <button
              onClick={() => openCreateFolderDialog()}
              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-sidebar-accent/50 text-sidebar-foreground"
              title="Create Root Folder"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <SidebarMenu>
            {isLoadingFolders ? (
              <div className="flex items-center justify-center py-4">
                <span className="text-sm text-muted-foreground">
                  Loading folders...
                </span>
              </div>
            ) : rootFolders.length === 0 ? (
              <div className="flex items-center justify-center py-4">
                <span className="text-sm text-muted-foreground">
                  No folders found
                </span>
              </div>
            ) : (
              rootFolders.map((folder) => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  isActive={activeFolder?.id === folder.id}
                  onSelect={() => handleFolderSelect(folder)}
                  onDelete={() => confirmDeleteFolder(folder)}
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/* Create Folder Dialog */}
        <Dialog
          open={showCreateFolderDialog}
          onOpenChange={setShowCreateFolderDialog}
        >
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Folder</DialogTitle>
              <DialogDescription>
                Enter a name for the new folder.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Input
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateFolderDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateFolder}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Folder Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Folder</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the folder "
                {folderToDelete?.name}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteFolder}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarContent>

      <SidebarFooter>
        <div className="relative w-full">
          <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-sidebar-muted" />
          <SidebarInput
            placeholder="Filter folders"
            className="pl-9"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
          />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

// Simple folder item component (no subfolders)
interface FolderItemProps {
  folder: FileSystemFolder;
  isActive?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function FolderItem({
  folder,
  isActive = false,
  onSelect,
  onDelete,
}: FolderItemProps) {
  return (
    <div key={folder.id}>
      <SidebarMenuButton
        onClick={(e) => {
          // If clicking on the folder name area, select it
          const target = e.target as HTMLElement;
          if (!target.closest("[data-dropdown-trigger]")) {
            onSelect();
          }
        }}
        className={`w-full pr-2 group ${
          isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
        }`}
      >
        <div className="flex items-center gap-2 flex-grow min-w-0">
          <FolderIcon className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{folder.name}</span>
          {isActive && (
            <span className="text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded-full ml-1 flex-shrink-0">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  data-dropdown-trigger
                  className="h-6 w-6 flex items-center justify-center rounded-sm hover:bg-sidebar-accent/50 ml-1"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-red-500"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SidebarMenuButton>
    </div>
  );
}
