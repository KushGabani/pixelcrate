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
const ACTIVE_FOLDER_STORAGE_KEY = 'pixelcrate_active_folder';

export function ActiveFolderProvider({ children }: { children: React.ReactNode }) {
  const [activeFolder, setActiveFolderState] = useState<ActiveFolder | null>(null);

  // Function to save active folder to localStorage
  const saveActiveFolderToStorage = useCallback((folder: ActiveFolder | null) => {
    try {
      if (folder) {
        localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, JSON.stringify(folder));
      } else {
        localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to save active folder to storage:', error);
    }
  }, []);

  // Function to load active folder from localStorage
  const loadActiveFolderFromStorage = useCallback((): ActiveFolder | null => {
    try {
      const stored = localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as ActiveFolder;
      }
    } catch (error) {
      console.error('Failed to load active folder from storage:', error);
    }
    return null;
  }, []);

  // Enhanced setActiveFolder that persists to storage
  const setActiveFolder = useCallback((folder: ActiveFolder | null) => {
    setActiveFolderState(folder);
    saveActiveFolderToStorage(folder);
  }, [saveActiveFolderToStorage]);

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

  // Initialize with saved folder from localStorage or default folder on mount
  useEffect(() => {
    const initializeActiveFolder = async () => {
      try {
        // First, try to load the saved active folder from localStorage
        const savedFolder = loadActiveFolderFromStorage();
        
        if (savedFolder) {
          // Verify that the saved folder still exists
          if (window.electron?.readDirectory) {
            try {
              // Check if the folder path still exists
              await window.electron.readDirectory(savedFolder.path);
              // If successful, use the saved folder
              setActiveFolderState(savedFolder);
              return;
            } catch (error) {
              console.log('Saved folder no longer exists, falling back to default:', error);
              // Remove the invalid saved folder from storage
              localStorage.removeItem(ACTIVE_FOLDER_STORAGE_KEY);
            }
          } else {
            // In web mode or if electron API not available, just use the saved folder
            setActiveFolderState(savedFolder);
            return;
          }
        }
        
        // If no saved folder or saved folder doesn't exist, ensure and use default folder
        const defaultFolder = await ensureDefaultFolder();
        setActiveFolder(defaultFolder);
      } catch (error) {
        console.error('Failed to initialize active folder:', error);
      }
    };

    // Only initialize if we don't have an active folder yet
    if (!activeFolder) {
      initializeActiveFolder();
    }
  }, [ensureDefaultFolder, loadActiveFolderFromStorage, setActiveFolder, activeFolder]);

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
