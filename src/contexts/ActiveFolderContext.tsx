import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface ActiveFolder {
  id: string;
  name: string;
  path: string;
  isDefault?: boolean;
}

interface ActiveFolderContextType {
  activeFolder: ActiveFolder | null;
  setActiveFolder: (folder: ActiveFolder | null) => void;
  ensureDefaultFolder: () => Promise<ActiveFolder>;
  getActiveFolderPath: () => string;
}

const ActiveFolderContext = createContext<ActiveFolderContextType | undefined>(undefined);

const DEFAULT_FOLDER_NAME = 'Default';

export function ActiveFolderProvider({ children }: { children: React.ReactNode }) {
  const [activeFolder, setActiveFolder] = useState<ActiveFolder | null>(null);

  // Function to ensure default folder exists and return it
  const ensureDefaultFolder = useCallback(async (): Promise<ActiveFolder> => {
    try {
      if (!window.electron?.getAppStorageDir || !window.electron?.createDirectory) {
        throw new Error('Electron APIs not available');
      }

      const appStorageDir = await window.electron.getAppStorageDir();
      const defaultFolderPath = `${appStorageDir}/images/${DEFAULT_FOLDER_NAME}`;
      
      // Try to create the default folder (will fail silently if it already exists)
      try {
        await window.electron.createDirectory(defaultFolderPath);
        console.log('Default folder created or already exists');
      } catch (error) {
        // Folder likely already exists, which is fine
        console.log('Default folder already exists or creation failed:', error);
      }

      const defaultFolder: ActiveFolder = {
        id: `fs_${defaultFolderPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
        name: DEFAULT_FOLDER_NAME,
        path: defaultFolderPath,
        isDefault: true,
      };

      return defaultFolder;
    } catch (error) {
      console.error('Failed to ensure default folder:', error);
      throw error;
    }
  }, []);

  // Function to get the current active folder path, with fallback to default
  const getActiveFolderPath = useCallback(() => {
    if (activeFolder) {
      return activeFolder.path;
    }
    // If no active folder, we'll need to handle this in the caller
    return '';
  }, [activeFolder]);

  // Initialize with default folder on mount
  useEffect(() => {
    const initializeDefaultFolder = async () => {
      try {
        const defaultFolder = await ensureDefaultFolder();
        if (!activeFolder) {
          setActiveFolder(defaultFolder);
        }
      } catch (error) {
        console.error('Failed to initialize default folder:', error);
      }
    };

    initializeDefaultFolder();
  }, [ensureDefaultFolder, activeFolder]);

  const value: ActiveFolderContextType = {
    activeFolder,
    setActiveFolder,
    ensureDefaultFolder,
    getActiveFolderPath,
  };

  return (
    <ActiveFolderContext.Provider value={value}>
      {children}
    </ActiveFolderContext.Provider>
  );
}

export function useActiveFolder() {
  const context = useContext(ActiveFolderContext);
  if (context === undefined) {
    throw new Error('useActiveFolder must be used within an ActiveFolderProvider');
  }
  return context;
}
