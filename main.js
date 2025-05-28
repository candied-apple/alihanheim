const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
let gamePath;

// Configure auto-updater
autoUpdater.checkForUpdatesAndNotify();
autoUpdater.autoDownload = false;

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    console.log('Checking for app update...');
    if (mainWindow) {
        mainWindow.webContents.send('app-update-checking');
    }
});

autoUpdater.on('update-available', (info) => {
    console.log('App update available.');
    if (mainWindow) {
        mainWindow.webContents.send('app-update-available', info);
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('App is up to date.');
    if (mainWindow) {
        mainWindow.webContents.send('app-update-not-available');
    }
});

autoUpdater.on('error', (err) => {
    console.log('Error in auto-updater. ' + err);
    if (mainWindow) {
        mainWindow.webContents.send('app-update-error', err.message);
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
        mainWindow.webContents.send('app-update-download-progress', progressObj);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('App update downloaded');
    if (mainWindow) {
        mainWindow.webContents.send('app-update-downloaded', info);
    }
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
    });

    mainWindow.loadFile('index.html');
    const userDataPath = path.normalize(app.getPath('userData'));
    gamePath = path.join(userDataPath, '.alihanheimfiles');
    
    // Check for app updates after window is ready
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Dosyaları güncelleme fonksiyonu
async function updateFiles() {
    return new Promise((resolve, reject) => {
        const filesUrl = 'https://vds.candiedapple.me/valheim_files.json';
        const whitelistUrl = 'https://vds.candiedapple.me/whitelisted_valheim.json';

        let filesToKeep = new Set();
        let directoriesToKeep = new Set();
        let prefixesToKeep = [];

        // Beyaz listeyi alma ve ayrıştırma
        https.get(whitelistUrl, (response) => {
            let whitelistData = '';
            response.on('data', chunk => {
                whitelistData += chunk;
            });
            response.on('end', () => {
                try {
                    const whitelist = JSON.parse(whitelistData);
                    whitelist.files.forEach(file => filesToKeep.add(file));
                    whitelist.directories.forEach(dir => directoriesToKeep.add(path.normalize(dir)));

                    if (whitelist.prefixes) {
                        prefixesToKeep = whitelist.prefixes.map(prefix => prefix.toLowerCase());
                    }

                    // Dosya listesini alma ve ayrıştırma
                    https.get(filesUrl, (response) => {
                        let data = '';
                        response.on('data', chunk => {
                            data += chunk;
                        });
                        response.on('end', () => {
                            try {
                                const files = JSON.parse(data);
                                let totalFiles = files.length;
                                let processedFiles = 0;

                                // files.json'dan dosyaları koruma setine ekle
                                files.forEach(file => filesToKeep.add(path.normalize(file.filename)));

                                // files.json'dan dosyaları işleme
                                files.forEach(file => {
                                    const filename = file.filename;
                                    const expectedHash = file.hash;
                                    const fileUrl = `https://vds.candiedapple.me/valheim/${filename}`;
                                    const fullPath = path.join(gamePath, filename);

                                    let fileExists = fs.existsSync(fullPath);
                                    let fileHash = '';

                                    if (fileExists) {
                                        fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                        if (fileHash === expectedHash) {
                                            console.log(`Dosya ${filename} güncel.`);
                                            processedFiles++;
                                            checkProgress();
                                            return;
                                        } else {
                                            console.log(`Dosya ${filename} değişmiş. Güncel dosya indiriliyor...`);
                                        }
                                    } else {
                                        console.log(`Dosya ${filename} mevcut değil. İndiriliyor...`);
                                    }

                                    const directory = path.dirname(fullPath);
                                    try {
                                        if (!fs.existsSync(directory)) {
                                            fs.mkdirSync(directory, { recursive: true });
                                        }
                                    } catch (err) {
                                        console.error(`Klasör oluşturulurken hata oluştu ${directory}:`, err);
                                        processedFiles++;
                                        checkProgress();
                                        return;
                                    }

                                    downloadFile(fileUrl, fullPath).then(() => {
                                        const downloadedFileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                        if (downloadedFileHash !== expectedHash) {
                                            console.log(`${filename} dosyası için indirme sonrası hash uyumsuzluğu.`);
                                        } else {
                                            console.log(`${filename} dosyası başarıyla indirildi ve güncel.`);
                                        }
                                        processedFiles++;
                                        checkProgress();
                                    }).catch(err => {
                                        console.error(`${filename} indirilemedi:`, err);
                                        processedFiles++;
                                        checkProgress();
                                    });
                                });

                                function removeOldFiles() {
                                    function deleteDirectoryRecursively(dirPath) {
                                        fs.readdir(dirPath, (err, files) => {
                                            if (err) {
                                                console.error(`Klasör okunurken hata oluştu ${dirPath}:`, err);
                                                return;
                                            }
                                            files.forEach(file => {
                                                const fullPath = path.join(dirPath, file);
                                                fs.stat(fullPath, (err, stats) => {
                                                    if (err) {
                                                        console.error(`Dosya istatistikleri alınırken hata oluştu ${fullPath}:`, err);
                                                        return;
                                                    }
                                                    if (stats.isDirectory()) {
                                                        deleteDirectoryRecursively(fullPath);
                                                    } else {
                                                        const relativeFilePath = path.relative(gamePath, fullPath);
                                                        const baseDir = relativeFilePath.split(path.sep)[0];
                                                        const fileName = path.basename(relativeFilePath);

                                                        if (
                                                            !filesToKeep.has(relativeFilePath) &&
                                                            !directoriesToKeep.has(baseDir) &&
                                                            !prefixesToKeep.some(prefix => fileName.toLowerCase().startsWith(prefix))
                                                        ) {
                                                            fs.unlink(fullPath, (err) => {
                                                                if (err) {
                                                                    console.error(`Dosya silinirken hata oluştu ${fullPath}:`, err);
                                                                } else {
                                                                    console.log(`Dosya silindi ${fullPath}`);
                                                                }
                                                            });
                                                        }
                                                    }
                                                });
                                            });

                                            fs.readdir(dirPath, (err, remainingFiles) => {
                                                if (err) {
                                                    console.error(`Klasör okunduktan sonra hata oluştu ${dirPath}:`, err);
                                                    return;
                                                }
                                                if (remainingFiles.length === 0 && !directoriesToKeep.has(path.relative(gamePath, dirPath)) && !prefixesToKeep.some(prefix => path.basename(dirPath).toLowerCase().startsWith(prefix))) {
                                                    fs.rmdir(dirPath, (err) => {
                                                        if (err) {
                                                            console.error(`Klasör silinirken hata oluştu ${dirPath}:`, err);
                                                        } else {
                                                            console.log(`Klasör silindi ${dirPath}`);
                                                        }
                                                    });
                                                }
                                            });
                                        });
                                    }

                                    deleteDirectoryRecursively(gamePath);
                                    resolve(true);
                                }

                                function checkProgress() {
                                    mainWindow.webContents.send('progress', {
                                        total: totalFiles,
                                        task: processedFiles,
                                        type: ''
                                    });

                                    if (processedFiles === totalFiles) {
                                        removeOldFiles();
                                    }
                                }
                            } catch (error) {
                                reject(`Dosya listesi ayrıştırılırken hata oluştu: ${error.message}`);
                            }
                        });
                    }).on('error', (err) => {
                        reject(`Dosya listesi alınırken hata oluştu: ${err.message}`);
                    });
                } catch (error) {
                    reject(`Beyaz liste ayrıştırılırken hata oluştu: ${error.message}`);
                }
            });
        }).on('error', (err) => {
            reject(`Beyaz liste alınırken hata oluştu: ${err.message}`);
        });
    });
}

// Dosya indirme fonksiyonu
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`Dosya silinirken hata oluştu: ${unlinkErr}`);
                }
            });
            reject(err);
        });
    });
}

// Valheim çalıştırıcı
function launchValheim() {
    const platform = os.platform();
    let executablePath;
    
    if (platform === 'win32') {
        executablePath = path.join(gamePath, 'valheim.exe');
    } else {
        executablePath = path.join(gamePath, 'valheim');
    }
    
    if (fs.existsSync(executablePath)) {
        const child = spawn(executablePath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log('Valheim başarıyla başlatıldı');
        app.quit();
    } else {
        console.error('Valheim çalıştırıcı dosyası bulunamadı:', executablePath);
        mainWindow.webContents.send('error', 'Valheim çalıştırıcı dosyası bulunamadı');
    }
}

// Güncelleme gerekip gerekmediğini kontrol et
async function checkForUpdates() {
    return new Promise((resolve) => {
        const filesUrl = 'https://vds.candiedapple.me/valheim_files.json';
        
        https.get(filesUrl, (response) => {
            let data = '';
            response.on('data', chunk => {
                data += chunk;
            });
            response.on('end', () => {
                try {
                    const files = JSON.parse(data);
                    let needsUpdate = false;
                    
                    for (const file of files) {
                        const fullPath = path.join(gamePath, file.filename);
                        
                        if (!fs.existsSync(fullPath)) {
                            needsUpdate = true;
                            break;
                        }
                        
                        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                        if (fileHash !== file.hash) {
                            needsUpdate = true;
                            break;
                        }
                    }
                    
                    resolve(needsUpdate);
                } catch (error) {
                    resolve(true); // Hata durumunda güncelleme gerekiyor varsay
                }
            });
        }).on('error', () => {
            resolve(true); // Hata durumunda güncelleme gerekiyor varsay
        });
    });
}

// IPC handlers
ipcMain.handle('update-files', async () => {
    try {
        await updateFiles();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.toString() };
    }
});

ipcMain.handle('play-game', async () => {
    try {
        mainWindow.webContents.send('update-started');
        await updateFiles();
        mainWindow.webContents.send('update-completed');
        launchValheim();
        return { success: true };
    } catch (error) {
        mainWindow.webContents.send('update-failed', error.toString());
        return { success: false, error: error.toString() };
    }
});

ipcMain.handle('launch-game', () => {
    launchValheim();
});

ipcMain.handle('check-updates', async () => {
    try {
        const needsUpdate = await checkForUpdates();
        return { needsUpdate };
    } catch (error) {
        return { needsUpdate: true };
    }
});

// New IPC handlers for app updates
ipcMain.handle('check-app-updates', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, updateInfo: result?.updateInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('download-app-update', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('install-app-update', () => {
    autoUpdater.quitAndInstall();
});
