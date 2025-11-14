// frontend/electron.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  // Load the React App (In dev mode, it looks at localhost:5173)
  // In production, it will look at the built file
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startPython() {
  const scriptPath = path.join(__dirname, '../frontend/main.py');
  const pythonExecutable = 'python'; // Or full path to your conda python.exe if needed

  console.log("Starting Python Backend...");
  pythonProcess = spawn(pythonExecutable, [scriptPath]);

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python]: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data}`);
  });
}

app.on('ready', () => {
  startPython();
  createWindow();
});

app.on('window-all-closed', function () {
  // Kill Python when the window closes
  if (pythonProcess) pythonProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});