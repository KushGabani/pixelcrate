interface IElectronAPI {
  // Window control methods
  minimize?: () => void;
  maximize?: () => void;
  close?: () => void;

  // File storage operations
  loadImages?: () => Promise<any[]>;
  saveImage?: (data: {
    id: string;
    dataUrl: string;
    metadata: any;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
  updateMetadata?: (data: {
    id: string;
    metadata: any;
  }) => Promise<{ success: boolean; error?: string }>;
  deleteImage?: (id: string) => Promise<{ success: boolean; error?: string }>;
  restoreFromTrash?: (
    id: string,
  ) => Promise<{ success: boolean; error?: string }>;
  emptyTrash?: () => Promise<{ success: boolean; error?: string }>;
  listTrash?: () => Promise<any[]>;
  getTrashDir?: () => Promise<string>;
  getAppStorageDir?: () => Promise<string>;
  openStorageDir?: () => Promise<{ success: boolean; error?: string }>;
  checkFileAccess?: (
    filePath: string,
  ) => Promise<{ success: boolean; accessible: boolean; error?: string }>;

  // Browser functionality
  openUrl?: (url: string) => void;

  // Update functionality
  checkForUpdates?: () => Promise<{ success: boolean }>;
  onUpdateAvailable?: (callback: (releaseInfo: any) => void) => () => void;
  onManualUpdateCheckCompleted?: (callback: () => void) => () => void;

  // Secure API key management
  setApiKey?: (
    service: string,
    key: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getApiKey?: (
    service: string,
  ) => Promise<{ success: boolean; key?: string; error?: string }>;
  hasApiKey?: (
    service: string,
  ) => Promise<{ success: boolean; hasKey: boolean; error?: string }>;
  deleteApiKey?: (
    service: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Analytics settings
  getAnalyticsConsent?: () => Promise<boolean>;
  setAnalyticsConsent?: (consent: boolean) => Promise<boolean>;
  onAnalyticsConsentChanged?: (
    callback: (consent: boolean) => void,
  ) => () => void;

  // User preferences
  setUserPreference?: (
    key: string,
    value: any,
  ) => Promise<{ success: boolean; error?: string }>;
  getUserPreference?: (
    key: string,
    defaultValue?: any,
  ) => Promise<{ success: boolean; value?: any; error?: string }>;

  // App information
  appVersion?: string;
  isDevelopmentMode?: () => boolean;

  // Added methods
  convertImageToBase64?: (filePath: string) => Promise<string>;

  saveMediaData?: (data: any) => Promise<any>;

  // Menu event handlers
  onImportFiles?: (callback: (filePaths: string[]) => void) => () => void;
  onOpenStorageLocation?: (callback: () => void) => () => void;
  onOpenSettings?: (callback: () => void) => () => void;
  
  // File system operations
  readDirectory?: (path: string) => Promise<{ name: string; path: string; isDirectory: boolean; isFile: boolean }[]>;
  createDirectory?: (path: string) => Promise<boolean>;
  deleteDirectory?: (path: string) => Promise<boolean>;
  getHomeDirectory?: () => Promise<string>;
  
  // Folder management
  loadFolders?: () => Promise<any[]>;
  createFolder?: (folder: any) => Promise<any>;
  updateFolder?: (id: string, updates: any) => Promise<any>;
  deleteFolder?: (id: string) => Promise<boolean>;
  moveFolder?: (folderId: string, newParentId?: string) => Promise<boolean>;
  getFolderStats?: () => Promise<any>;
  addImageToFolder?: (imageId: string, folderId: string) => Promise<boolean>;
  removeImageFromFolder?: (imageId: string) => Promise<boolean>;
  moveImageToFolder?: (imageId: string, folderId: string) => Promise<boolean>;
}

// Define the protocol for local file access
declare global {
  interface Window {
    electron?: IElectronAPI;
  }
}

declare global {
  interface Window {
    electron?: IElectronAPI;
  }
}

export {};
