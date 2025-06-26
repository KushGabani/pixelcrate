import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  Menu,
} from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import os from "os";
import { promises as fsPromises } from "fs"; // Import fsPromises
import chokidar from "chokidar";
// We'll use dynamic import for electron-window-state instead
// import windowStateKeeper from 'electron-window-state';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect development mode without using electron-is-dev
const isDev =
  process.env.NODE_ENV === "development" ||
  !/[\\/]app\.asar[\\/]/.test(__dirname);

// Global storage path that will be exposed to the renderer
let appStorageDir;
let trashDir;
let mainWindow;

// Analytics preferences store
const analyticsPreferences = {
  consentGiven: true, // Default to true (opt-out model)

  // Get the file path for storing analytics preferences
  get filePath() {
    return path.join(app.getPath("userData"), "analytics-preferences.json");
  },

  // Load preferences from disk
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        const prefs = JSON.parse(data);
        this.consentGiven = prefs.consentGiven ?? true;
        console.log(
          "Loaded analytics preferences, consent:",
          this.consentGiven,
        );
      } else {
        console.log(
          "No analytics preferences file found, using default consent:",
          this.consentGiven,
        );
      }
    } catch (error) {
      console.error("Error loading analytics preferences:", error);
    }
  },

  // Save preferences to disk
  save() {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ consentGiven: this.consentGiven }),
        "utf8",
      );
      console.log("Saved analytics preferences, consent:", this.consentGiven);
    } catch (error) {
      console.error("Error saving analytics preferences:", error);
    }
  },

  // Get current consent status
  getConsent() {
    return this.consentGiven;
  },

  // Update consent status
  setConsent(consent) {
    this.consentGiven = !!consent;
    this.save();
    return this.consentGiven;
  },
};

// Simple API key storage with basic persistence
const apiKeyStorage = {
  keys: new Map(),
  initialized: false,

  // Storage file path
  get filePath() {
    return path.join(app.getPath("userData"), "api-keys.json");
  },

  // Load stored keys from disk
  init() {
    if (this.initialized) return;

    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        const keyData = JSON.parse(data);

        // Convert back from object to Map
        Object.entries(keyData).forEach(([service, key]) => {
          this.keys.set(service, key);
        });

        console.log("API keys loaded from disk");
      }
    } catch (error) {
      console.error("Error loading API keys from disk:", error);
    }

    this.initialized = true;
  },

  // Save keys to disk
  save() {
    try {
      // Convert Map to object for JSON serialization
      const keyData = {};
      this.keys.forEach((value, key) => {
        keyData[key] = value;
      });

      fs.writeFileSync(this.filePath, JSON.stringify(keyData, null, 2), "utf8");
    } catch (error) {
      console.error("Error saving API keys to disk:", error);
    }
  },

  setApiKey(service, key) {
    if (!service || !key) return false;
    try {
      this.init();
      this.keys.set(service, key);
      this.save();
      return true;
    } catch (error) {
      console.error(`Error storing API key for ${service}:`, error);
      return false;
    }
  },

  getApiKey(service) {
    if (!service) return null;
    try {
      this.init();
      return this.keys.get(service) || null;
    } catch (error) {
      console.error(`Error retrieving API key for ${service}:`, error);
      return null;
    }
  },

  hasApiKey(service) {
    this.init();
    return this.keys.has(service);
  },

  deleteApiKey(service) {
    if (!service) return false;
    try {
      this.init();
      const result = this.keys.delete(service);
      if (result) this.save();
      return result;
    } catch (error) {
      console.error(`Error deleting API key for ${service}:`, error);
      return false;
    }
  },
};

// Determine app storage directory in iCloud or local folder
const getAppStorageDir = async () => {
  const platform = process.platform;
  let storageDir;

  if (platform === "darwin") {
    // On macOS, try to use Documents folder first for visibility
    const homeDir = os.homedir();
    storageDir = path.join(homeDir, "Documents", "PixelCrate");
    console.log("Using Documents folder path:", storageDir);

    // Create a README file to help users find the folder
    const readmePath = path.join(storageDir, "README.txt");
    if (!fs.existsSync(readmePath)) {
      fs.ensureDirSync(storageDir);
      fs.writeFileSync(
        readmePath,
        "This folder contains your PixelCrate app images and data.\n" +
          "Files are stored in the images/ directory with metadata in the metadata/ directory.\n\n" +
          "Storage location: " +
          storageDir,
      );
    }
  } else {
    // For other platforms, use app.getPath('userData')
    storageDir = path.join(app.getPath("userData"), "storage");
    console.log("Using userData path:", storageDir);
  }

  // Ensure main directory exists
  fs.ensureDirSync(storageDir);

  // Create images and metadata subdirectories
  const imagesDir = path.join(storageDir, "images");
  const metadataDir = path.join(storageDir, "metadata");
  fs.ensureDirSync(imagesDir);
  fs.ensureDirSync(metadataDir);

  // Create trash directory
  trashDir = path.join(storageDir, ".trash");
  fs.ensureDirSync(trashDir);
  // Create trash subdirectories for images and metadata
  const trashImagesDir = path.join(trashDir, "images");
  const trashMetadataDir = path.join(trashDir, "metadata");
  fs.ensureDirSync(trashImagesDir);
  fs.ensureDirSync(trashMetadataDir);

  // Empty trash on startup
  await fs.emptyDir(trashImagesDir);
  await fs.emptyDir(trashMetadataDir);
  console.log("Trash emptied on startup");

  // Create queue directory for mobile imports
  const queueDir = path.join(storageDir, "queue");
  await fs.ensureDir(queueDir);
  console.log("Queue directories created");

  return storageDir;
};

// Add this function before createWindow()
async function checkForUpdates() {
  try {
    // Read package.json using fs instead of require
    const packageJsonPath = path.join(path.dirname(__dirname), "package.json");
    const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    const currentVersion = packageJson.version;

    const repoOwner = "gustavscirulis"; // Repository owner
    const repoName = "pixelcrate"; // Repository name

    console.log("Checking for updates. Current version:", currentVersion);

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`,
    );

    if (!response.ok) {
      console.error("Error checking for updates:", response.status);
      return;
    }

    const latestRelease = await response.json();
    const latestVersion = latestRelease.tag_name.replace(/^v/, "");

    console.log("Latest version available:", latestVersion);

    // Compare versions (simple string comparison works for semver)
    if (latestVersion > currentVersion) {
      console.log("Update available!", latestRelease.name);

      // Notify renderer process about the update
      if (mainWindow) {
        mainWindow.webContents.send("update-available", latestRelease);
      }
    } else {
      console.log("No updates available");
    }
  } catch (error) {
    console.error("Failed to check for updates:", error);
  }
}

async function createWindow() {
  appStorageDir = await getAppStorageDir();
  console.log("App storage directory:", appStorageDir);

  // Import windowStateKeeper dynamically
  let windowState;
  try {
    // When using dynamic import in production builds, the module resolution might be different
    // Add more robust error handling and logging
    console.log("Attempting to load electron-window-state...");
    let windowStateKeeper;
    try {
      windowStateKeeper = (await import("electron-window-state")).default;
    } catch (importError) {
      console.error("Error importing electron-window-state:", importError);
      // Try alternative import method for production
      const windowStateModule = await import("electron-window-state");
      windowStateKeeper = windowStateModule.default || windowStateModule;
      console.log("Using alternative import method for electron-window-state");
    }

    if (!windowStateKeeper || typeof windowStateKeeper !== "function") {
      throw new Error(
        "electron-window-state module did not return a valid function",
      );
    }

    // Use an absolute path for the file in userData to ensure it works in production
    const userDataPath = app.getPath("userData");
    console.log("Using userData path for window state:", userDataPath);

    windowState = windowStateKeeper({
      defaultWidth: 1280,
      defaultHeight: 800,
      file: path.join(userDataPath, "window-state.json"),
    });

    console.log("Window state initialized successfully");
  } catch (err) {
    console.error("Failed to load or initialize electron-window-state:", err);
    // Provide a complete fallback with manual state persistence
    const stateFilePath = path.join(
      app.getPath("userData"),
      "window-state.json",
    );
    let savedState = { width: 1280, height: 800, x: undefined, y: undefined };

    // Try to load saved state from file
    try {
      if (fs.existsSync(stateFilePath)) {
        const data = fs.readFileSync(stateFilePath, "utf8");
        const loadedState = JSON.parse(data);
        savedState = { ...savedState, ...loadedState };
        console.log("Loaded window state from fallback file:", savedState);
      }
    } catch (loadError) {
      console.error(
        "Error loading window state from fallback file:",
        loadError,
      );
    }

    // Create a full fallback implementation
    windowState = {
      ...savedState,
      manage: () => {},
      saveState: (win) => {
        // Manual implementation of state saving
        try {
          if (!win || win.isDestroyed()) return;

          const bounds = win.getBounds();
          const isMaximized = win.isMaximized();
          const isFullScreen = win.isFullScreen();

          const stateToSave = {
            ...bounds,
            isMaximized,
            isFullScreen,
          };

          fs.writeFileSync(stateFilePath, JSON.stringify(stateToSave), "utf8");
          console.log("Saved window state using fallback method:", stateToSave);
        } catch (saveError) {
          console.error(
            "Error saving window state in fallback method:",
            saveError,
          );
        }
      },
    };
    console.log("Using fallback window state implementation");
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 13, y: 13 },
    backgroundColor: "#10121A",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: false, // Required for preload to access Node APIs
    },
    icon: path.join(__dirname, "../assets/icons/icon.png"),
  });

  // Let windowState manage the window state
  if (typeof windowState.manage === "function") {
    windowState.manage(mainWindow);
  }

  // Register listeners for window state saving
  ["resize", "move", "close"].forEach((event) => {
    mainWindow.on(event, () => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        typeof windowState.saveState === "function"
      ) {
        // Only call saveState if it's a function
        windowState.saveState(mainWindow);
      }
    });
  });

  // In production, use file protocol with the correct path
  // In development, use localhost server with flexible port detection
  const devPort = process.env.DEV_PORT || "8080"; // Default to 8080 to match Vite's configuration
  const startUrl = isDev
    ? `http://localhost:${devPort}`
    : `file://${path.join(__dirname, "../dist/index.html")}`;

  console.log("Loading application from:", startUrl);

  // Add webSecurity configuration and CSP for local media playback and OpenAI API
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self' 'unsafe-inline' local-file: file: data:; connect-src 'self' https://generativelanguage.googleapis.com https://*.telemetrydeck.com https://nom.telemetrydeck.com https://telemetrydeck.com local-file: file: data:; script-src 'self' 'unsafe-inline' blob:; media-src 'self' local-file: file: blob: data:; img-src 'self' local-file: file: blob: data:;",
          ],
        },
      });
    },
  );

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Create the application menu
  createApplicationMenu();
}

// Create the application menu with File browsing options
function createApplicationMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates",
                click: async () => {
                  await checkForUpdates();
                  // If no update was found, inform the user
                  if (mainWindow) {
                    mainWindow.webContents.send(
                      "manual-update-check-completed",
                    );
                  }
                },
              },
              { type: "separator" },
              {
                label: "Preferences",
                accelerator: "CmdOrCtrl+,",
                click: () => mainWindow?.webContents.send("open-settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: "File",
      submenu: [
        {
          label: "Import Image",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ["openFile", "multiSelections"],
              filters: [
                {
                  name: "Images",
                  extensions: ["jpg", "jpeg", "png", "gif", "webp"],
                },
                { name: "Videos", extensions: ["mp4", "webm", "mov"] },
                { name: "All Files", extensions: ["*"] },
              ],
            });

            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("import-files", result.filePaths);
            }
          },
        },
        {
          label: "Open Storage Location",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            mainWindow?.webContents.send("open-storage-location");
            await shell.openPath(appStorageDir);
          },
        },
      ],
    },

    // Edit menu
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ]
          : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
      ],
    },

    // View menu
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    // Window menu
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },

    // Help menu
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal("https://github.com/gustavscirulis/pixelcrate");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Register custom protocol to serve local files
  protocol.registerFileProtocol("local-file", (request, callback) => {
    const url = request.url.replace("local-file://", "");
    try {
      const filePath = decodeURI(url);
      const ext = path.extname(filePath).toLowerCase();

      // Set appropriate MIME type based on file extension
      let mimeType = "application/octet-stream";
      if (ext === ".mp4") {
        mimeType = "video/mp4";
      } else if (ext === ".webm") {
        mimeType = "video/webm";
      } else if (ext === ".png") {
        mimeType = "image/png";
      } else if (ext === ".jpg" || ext === ".jpeg") {
        mimeType = "image/jpeg";
      }

      return callback({
        path: filePath,
        headers: {
          "Content-Type": mimeType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      console.error("Error with protocol handler:", error);
    }
  });

  analyticsPreferences.load();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle window control events
ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close();
});

// Add API key management handlers
ipcMain.handle("set-api-key", async (event, { service, key }) => {
  try {
    const success = apiKeyStorage.setApiKey(service, key);
    return { success };
  } catch (error) {
    console.error("Error in set-api-key:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-api-key", async (event, { service }) => {
  try {
    const key = apiKeyStorage.getApiKey(service);
    return { success: true, key };
  } catch (error) {
    console.error("Error getting API key:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("has-api-key", async (event, { service }) => {
  try {
    const hasKey = apiKeyStorage.hasApiKey(service);
    return { success: true, hasKey };
  } catch (error) {
    console.error("Error checking API key existence:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("delete-api-key", async (event, { service }) => {
  try {
    const result = apiKeyStorage.deleteApiKey(service);
    return { success: result };
  } catch (error) {
    console.error("Error deleting API key:", error);
    return { success: false, error: error.message };
  }
});

// IPC handlers for file system operations
ipcMain.handle("get-app-storage-dir", () => {
  return appStorageDir;
});

ipcMain.handle("get-trash-dir", () => {
  return trashDir;
});

ipcMain.handle("open-storage-dir", () => {
  return shell.openPath(appStorageDir);
});

ipcMain.handle("save-image", async (event, { id, dataUrl, metadata, folderPath }) => {
  try {
    // Determine if this is a video or image based on the ID prefix or metadata
    const isVideo = id.startsWith("vid_") || metadata.type === "video";

    // Choose the appropriate file extension
    const fileExt = isVideo ? ".mp4" : ".png";

    // Destination paths - use folderPath if provided, otherwise default to images directory
    let targetDir;
    if (folderPath && folderPath.trim()) {
      // Use the specific folder path provided
      targetDir = folderPath;
    } else {
      // Default to images directory
      targetDir = path.join(appStorageDir, "images");
    }

    // Ensure target directory exists
    await fs.ensureDir(targetDir);
    
    const filePath = path.join(targetDir, `${id}${fileExt}`);

    // Check if dataUrl is a file path rather than a base64 data URL
    const isFilePath = !dataUrl.startsWith("data:");

    if (isFilePath) {
      // Copy the file directly instead of decoding base64
      console.log(`Copying file directly from: ${dataUrl}`);
      try {
        await fs.copy(dataUrl, filePath);
      } catch (copyError) {
        console.error("Error copying file:", copyError);
        throw new Error(`Failed to copy file: ${copyError.message}`);
      }
    } else {
      // Process as base64 data URL
      // Strip data URL prefix to get base64 data
      let base64Data;
      if (isVideo) {
        base64Data = dataUrl.replace(/^data:video\/\w+;base64,/, "");
      } else {
        base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      }
      const buffer = Buffer.from(base64Data, "base64");

      // Save media file with correct extension in the target directory
      await fs.writeFile(filePath, buffer);
    }

    console.log(`Media saved to: ${filePath}`);

    // Save metadata as separate JSON file in the metadata directory
    const metadataDir = path.join(appStorageDir, "metadata");
    const metadataPath = path.join(metadataDir, `${id}.json`);
    await fs.writeJson(metadataPath, {
      ...metadata,
      filePath: filePath, // Include actual file path in metadata
      folderPath: targetDir, // Include folder path in metadata
      type: isVideo ? "video" : "image", // Ensure type is correctly set
    });

    console.log(`File is accessible`);
    return { success: true, path: filePath };
  } catch (error) {
    console.error("Error saving image:", error);
    return { success: false, error: error.message };
  }
});

// Helper function to recursively find media files in all subdirectories
const findMediaFileRecursively = async (id, fileExt, searchDir) => {
  try {
    // First, check if file exists in the main search directory
    const directPath = path.join(searchDir, `${id}${fileExt}`);
    if (await fs.pathExists(directPath)) {
      return directPath;
    }

    // If not found, recursively search all subdirectories
    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(searchDir, entry.name);
        const foundPath = await findMediaFileRecursively(id, fileExt, subDirPath);
        if (foundPath) {
          return foundPath;
        }
      }
    }
    
    return null;
  } catch (error) {
    // If directory doesn't exist or can't be read, return null
    return null;
  }
};

// Add the missing load-images handler
ipcMain.handle("load-images", async () => {
  try {
    const metadataDir = path.join(appStorageDir, "metadata");
    
    // Check if metadata directory exists
    if (!(await fs.pathExists(metadataDir))) {
      console.log("Metadata directory does not exist yet");
      return [];
    }
    
    const files = await fs.readdir(metadataDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const images = await Promise.all(
      jsonFiles.map(async (file) => {
        const id = path.basename(file, ".json");
        const metadataPath = path.join(metadataDir, file);

        // Check if this is a video based on id prefix
        const isVideo = id.startsWith("vid_");
        // Use appropriate extension
        const fileExt = isVideo ? ".mp4" : ".png";
        const imagesDir = path.join(appStorageDir, "images");
        
        try {
          // Load metadata first to get folder information
          const metadata = await fs.readJson(metadataPath);
          
          // Try to find the media file - first check if metadata has folderPath
          let mediaPath;
          if (metadata.folderPath && await fs.pathExists(metadata.folderPath)) {
            // Check if file exists in the specified folder path
            const folderMediaPath = path.join(metadata.folderPath, `${id}${fileExt}`);
            if (await fs.pathExists(folderMediaPath)) {
              mediaPath = folderMediaPath;
            }
          }
          
          // If not found in metadata folder path, search recursively
          if (!mediaPath) {
            mediaPath = await findMediaFileRecursively(id, fileExt, imagesDir);
          }
          
          // Check if media file was found
          if (!mediaPath) {
            console.warn(`Media file not found for ID: ${id}`);
            return null;
          }

          // Use the local-file protocol for both images and videos
          const localFileUrl = `local-file://${mediaPath}`;

          // Construct the media object with correct paths
          const mediaObject = {
            ...metadata,
            id,
            url: localFileUrl,
            type: isVideo ? "video" : metadata.type || "image",
            actualFilePath: mediaPath,
            useDirectPath: true, // Flag to indicate this is a direct file path
          };

          return mediaObject;
        } catch (err) {
          console.error(`Error loading image ${id}:`, err);
          return null;
        }
      }),
    );

    // Filter out any null entries (failed loads)
    const validImages = images.filter(Boolean);
    console.log(`Loaded ${validImages.length} images from ${jsonFiles.length} metadata files`);
    return validImages;
  } catch (error) {
    console.error("Error loading images:", error);
    return [];
  }
});

// Add the delete-image handler
ipcMain.handle("delete-image", async (event, id) => {
  try {
    // Determine if this is a video based on id prefix
    const isVideo = id.startsWith("vid_");
    const fileExt = isVideo ? ".mp4" : ".png";

    const imagesDir = path.join(appStorageDir, "images");
    const metadataDir = path.join(appStorageDir, "metadata");
    const metadataPath = path.join(metadataDir, `${id}.json`);

    // Find the actual media file using the recursive search
    let mediaPath = await findMediaFileRecursively(id, fileExt, imagesDir);
    
    if (!mediaPath) {
      throw new Error(`Media file not found for ID: ${id}`);
    }

    const trashImagesDir = path.join(trashDir, "images");
    const trashMetadataDir = path.join(trashDir, "metadata");
    const trashMediaPath = path.join(trashImagesDir, `${id}${fileExt}`);
    const trashMetadataPath = path.join(trashMetadataDir, `${id}.json`);

    // Move files to trash instead of deleting
    await fs.move(mediaPath, trashMediaPath, { overwrite: true });
    await fs.move(metadataPath, trashMetadataPath, { overwrite: true });

    console.log(`Moved media to trash: ${trashMediaPath}`);
    return { success: true };
  } catch (error) {
    console.error("Error moving image to trash:", error);
    return { success: false, error: error.message };
  }
});

// Add restore-from-trash handler
ipcMain.handle("restore-from-trash", async (event, id) => {
  try {
    // Determine if this is a video based on id prefix
    const isVideo = id.startsWith("vid_");
    const fileExt = isVideo ? ".mp4" : ".png";

    const metadataDir = path.join(appStorageDir, "metadata");
    const metadataPath = path.join(metadataDir, `${id}.json`);

    const trashImagesDir = path.join(trashDir, "images");
    const trashMetadataDir = path.join(trashDir, "metadata");
    const trashMediaPath = path.join(trashImagesDir, `${id}${fileExt}`);
    const trashMetadataPath = path.join(trashMetadataDir, `${id}.json`);

    // Load metadata from trash to get original folder path
    const metadata = await fs.readJson(trashMetadataPath);
    
    // Determine restoration path - use original folderPath if available
    let targetDir;
    if (metadata.folderPath && await fs.pathExists(path.dirname(metadata.folderPath))) {
      targetDir = metadata.folderPath;
    } else {
      // Fallback to default images directory
      targetDir = path.join(appStorageDir, "images");
    }
    
    // Ensure target directory exists
    await fs.ensureDir(targetDir);
    
    const mediaPath = path.join(targetDir, `${id}${fileExt}`);

    // Move files back from trash
    await fs.move(trashMediaPath, mediaPath, { overwrite: true });
    await fs.move(trashMetadataPath, metadataPath, { overwrite: true });

    console.log(`Restored media from trash to: ${mediaPath}`);
    return { success: true };
  } catch (error) {
    console.error("Error restoring from trash:", error);
    return { success: false, error: error.message };
  }
});

// Add empty-trash handler
ipcMain.handle("empty-trash", async () => {
  try {
    await fs.emptyDir(path.join(trashDir, "images"));
    await fs.emptyDir(path.join(trashDir, "metadata"));
    console.log("Trash emptied successfully");
    return { success: true };
  } catch (error) {
    console.error("Error emptying trash:", error);
    return { success: false, error: error.message };
  }
});

// Add list-trash handler
ipcMain.handle("list-trash", async () => {
  try {
    const trashMetadataDir = path.join(trashDir, "metadata");
    const files = await fs.readdir(trashMetadataDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const trashItems = await Promise.all(
      jsonFiles.map(async (file) => {
        const id = path.basename(file, ".json");
        const metadataPath = path.join(trashMetadataDir, file);
        const isVideo = id.startsWith("vid_");
        const fileExt = isVideo ? ".mp4" : ".png";
        const trashImagesDir = path.join(trashDir, "images");
        const mediaPath = path.join(trashImagesDir, `${id}${fileExt}`);

        try {
          if (!(await fs.pathExists(mediaPath))) {
            // Skip missing files silently
            return null;
          }

          const metadata = await fs.readJson(metadataPath);
          const localFileUrl = `local-file://${mediaPath}`;

          return {
            ...metadata,
            id,
            url: localFileUrl,
            type: isVideo ? "video" : metadata.type || "image",
            actualFilePath: mediaPath,
            useDirectPath: true,
          };
        } catch (err) {
          // Skip files that can't be loaded
          return null;
        }
      }),
    );

    return trashItems.filter(Boolean);
  } catch (error) {
    console.error("Error listing trash:", error);
    return [];
  }
});

// Add check-file-access handler
ipcMain.handle("check-file-access", async (event, filePath) => {
  try {
    // Check if file exists and is readable
    await fsPromises.access(filePath, fsPromises.constants.R_OK);
    console.log(`File is accessible: ${filePath}`);
    return { success: true, accessible: true };
  } catch (error) {
    console.error(`File access error for ${filePath}:`, error);
    return { success: true, accessible: false, error: error.message };
  }
});

// Add open-url handler
ipcMain.handle("open-url", async (event, url) => {
  try {
    await shell.openExternal(url);
    console.log(`Opened URL in default browser: ${url}`);
    return { success: true };
  } catch (error) {
    console.error("Error opening URL:", error);
    return { success: false, error: error.message };
  }
});

// Add update-metadata handler
ipcMain.handle("update-metadata", async (event, { id, metadata }) => {
  try {
    const metadataDir = path.join(appStorageDir, "metadata");
    const metadataPath = path.join(metadataDir, `${id}.json`);
    await fs.writeJson(metadataPath, metadata);
    console.log(`Updated metadata at: ${metadataPath}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating metadata:", error);
    return { success: false, error: error.message };
  }
});

// Register IPC handlers for analytics consent management
ipcMain.handle("get-analytics-consent", async () => {
  try {
    const consent = analyticsPreferences.getConsent();
    console.log("Get analytics consent request, returning:", consent);
    return consent;
  } catch (error) {
    console.error("Error getting analytics consent:", error);
    return false;
  }
});

ipcMain.handle("set-analytics-consent", async (event, consent) => {
  try {
    console.log("Setting analytics consent to:", consent);
    const result = analyticsPreferences.setConsent(consent);
    console.log("Analytics consent set result:", result);
    // Notify renderer of the change
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("analytics-consent-changed", result);
    }
    return result;
  } catch (error) {
    console.error("Error setting analytics consent:", error);
    return false;
  }
});

// Add handler for manual update checks from renderer
ipcMain.handle("check-for-updates", async () => {
  await checkForUpdates();
  return { success: true };
});

// Add handlers for user preferences (thumbnail size, etc.)
const userPreferences = {
  prefs: new Map(),
  initialized: false,

  // Storage file path
  get filePath() {
    return path.join(app.getPath("userData"), "user-preferences.json");
  },

  // Load stored preferences from disk
  init() {
    if (this.initialized) return;

    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        const prefData = JSON.parse(data);

        // Convert back from object to Map
        Object.entries(prefData).forEach(([key, value]) => {
          this.prefs.set(key, value);
        });

        console.log("User preferences loaded from disk");
      }
    } catch (error) {
      console.error("Error loading user preferences from disk:", error);
    }

    this.initialized = true;
  },

  // Save preferences to disk
  save() {
    try {
      // Convert Map to object for JSON serialization
      const prefData = {};
      this.prefs.forEach((value, key) => {
        prefData[key] = value;
      });

      fs.writeFileSync(
        this.filePath,
        JSON.stringify(prefData, null, 2),
        "utf8",
      );
    } catch (error) {
      console.error("Error saving user preferences to disk:", error);
    }
  },

  setPreference(key, value) {
    if (!key) return false;
    try {
      this.init();
      this.prefs.set(key, value);
      this.save();
      return true;
    } catch (error) {
      console.error(`Error storing preference ${key}:`, error);
      return false;
    }
  },

  getPreference(key, defaultValue = null) {
    if (!key) return defaultValue;
    try {
      this.init();
      return this.prefs.get(key) || defaultValue;
    } catch (error) {
      console.error(`Error retrieving preference ${key}:`, error);
      return defaultValue;
    }
  },
};

ipcMain.handle("set-user-preference", async (event, { key, value }) => {
  try {
    const success = userPreferences.setPreference(key, value);
    return { success };
  } catch (error) {
    console.error("Error in set-user-preference:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-user-preference", async (event, { key, defaultValue }) => {
  try {
    const value = userPreferences.getPreference(key, defaultValue);
    return { success: true, value };
  } catch (error) {
    console.error("Error getting user preference:", error);
    return { success: false, error: error.message };
  }
});

// Queue management variables
let queueWatcher = null;
let queueProcessingActive = false;

// Start watching the queue folder for new images
ipcMain.handle("queue:start-watching", async () => {
  try {
    if (queueWatcher) {
      console.log("Queue watcher already running");
      return { success: true, message: "Already watching" };
    }

    const queueDir = path.join(appStorageDir, "queue");

    queueWatcher = chokidar.watch(queueDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false,
    });

    queueWatcher.on("add", (filePath) => {
      console.log("New file detected in queue:", filePath);
      // Notify renderer about new queued file
      if (mainWindow) {
        mainWindow.webContents.send("queue:new-file", filePath);
      }
    });

    queueWatcher.on("error", (error) => {
      console.error("Queue watcher error:", error);
    });

    console.log("Started watching queue directory:", queueDir);
    return { success: true, message: "Queue watching started" };
  } catch (error) {
    console.error("Error starting queue watcher:", error);
    return { success: false, error: error.message };
  }
});

// Stop watching the queue folder
ipcMain.handle("queue:stop-watching", async () => {
  try {
    if (queueWatcher) {
      await queueWatcher.close();
      queueWatcher = null;
      console.log("Queue watcher stopped");
    }
    return { success: true, message: "Queue watching stopped" };
  } catch (error) {
    console.error("Error stopping queue watcher:", error);
    return { success: false, error: error.message };
  }
});

// Get list of files in queue
ipcMain.handle("queue:list-files", async () => {
  try {
    const queueDir = path.join(appStorageDir, "queue");
    const files = await fs.readdir(queueDir);
    const imageFiles = files.filter((file) =>
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i.test(file),
    );

    return {
      success: true,
      files: imageFiles.map((file) => path.join(queueDir, file)),
    };
  } catch (error) {
    console.error("Error listing queue files:", error);
    return { success: false, error: error.message, files: [] };
  }
});

// Process a single queued file (move it to main library)
ipcMain.handle("queue:process-file", async (event, filePath) => {
  try {
    const queueDir = path.join(appStorageDir, "queue");

    // Check if file is in queue directory
    if (!filePath.startsWith(queueDir)) {
      throw new Error("File is not in queue directory");
    }

    // Check if file exists
    if (!(await fs.pathExists(filePath))) {
      throw new Error("File does not exist");
    }

    // Get file stats for the import
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);

    console.log("Processing queued file:", fileName);

    // Return file info for processing by renderer
    return {
      success: true,
      filePath,
      fileName,
      size: stats.size,
      modified: stats.mtime.toISOString(),
    };
  } catch (error) {
    console.error("Error processing queued file:", error);
    return { success: false, error: error.message };
  }
});

// Remove processed file from queue
ipcMain.handle("queue:remove-file", async (event, filePath) => {
  try {
    const queueDir = path.join(appStorageDir, "queue");

    // Check if file is in queue directory
    if (!filePath.startsWith(queueDir)) {
      throw new Error("File is not in queue directory");
    }

    await fs.remove(filePath);
    console.log("Removed processed file from queue:", path.basename(filePath));

    return { success: true, message: "File removed from queue" };
  } catch (error) {
    console.error("Error removing file from queue:", error);
    return { success: false, error: error.message };
  }
});

// Directory management handlers
ipcMain.handle("get-home-directory", async () => {
  try {
    const homeDir = os.homedir();
    console.log("Home directory:", homeDir);
    return homeDir;
  } catch (error) {
    console.error("Error getting home directory:", error);
    throw error;
  }
});

ipcMain.handle("read-directory", async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      throw new Error("Directory does not exist");
    }

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      // Skip hidden files/directories (starting with .)
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      try {
        const entryStats = await fs.stat(fullPath);
        result.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entryStats.isDirectory(),
          isFile: entryStats.isFile(),
          size: entryStats.size,
          modified: entryStats.mtime.toISOString()
        });
      } catch (statError) {
        // Skip entries we can't stat (permission issues, etc.)
        console.warn(`Could not stat ${fullPath}:`, statError.message);
        continue;
      }
    }

    console.log(`Read directory ${dirPath}: found ${result.length} entries`);
    return result;
  } catch (error) {
    console.error("Error reading directory:", error);
    throw error;
  }
});

ipcMain.handle("create-directory", async (event, dirPath) => {
  try {
    // Validate the path is safe (not trying to create outside reasonable bounds)
    const resolvedPath = path.resolve(dirPath);
    const homeDir = os.homedir();
    
    // Only allow creating directories within user's home directory for security
    if (!resolvedPath.startsWith(homeDir)) {
      throw new Error("Directory creation outside home directory is not allowed");
    }

    // Check if directory already exists
    if (fs.existsSync(resolvedPath)) {
      throw new Error("Directory already exists");
    }

    // Create the directory
    await fs.ensureDir(resolvedPath);
    console.log("Created directory:", resolvedPath);
    return true;
  } catch (error) {
    console.error("Error creating directory:", error);
    throw error;
  }
});

ipcMain.handle("delete-directory", async (event, dirPath) => {
  try {
    // Validate the path is safe
    const resolvedPath = path.resolve(dirPath);
    const homeDir = os.homedir();
    
    // Only allow deleting directories within user's home directory for security
    if (!resolvedPath.startsWith(homeDir)) {
      throw new Error("Directory deletion outside home directory is not allowed");
    }

    // Check if directory exists
    if (!fs.existsSync(resolvedPath)) {
      throw new Error("Directory does not exist");
    }

    // Ensure it's actually a directory
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    // Remove the directory
    await fs.remove(resolvedPath);
    console.log("Deleted directory:", resolvedPath);
    return true;
  } catch (error) {
    console.error("Error deleting directory:", error);
    throw error;
  }
});
