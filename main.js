const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
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

// Boyut formatlama fonksiyonu
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Dosyaları güncelleme fonksiyonu
async function updateFiles() {
    return new Promise((resolve, reject) => {
        const filesUrl = 'https://vds.candiedapple.me/valheim_files.json';
        const whitelistUrl = 'https://vds.candiedapple.me/whitelisted_valheim.json';

        let filesToKeep = new Set();
        let directoriesToKeep = new Set();
        let prefixesToKeep = [];
          // Progress throttling için
        let lastProgressUpdate = 0;
        const PROGRESS_THROTTLE_MS = 500; // 500ms'de bir güncelle (daha okunabilir)

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
                                let totalBytes = 0;
                                let downloadedBytes = 0;
                                let filesToDownload = [];

                                // Toplam boyutu ve indirilen dosyaları hesapla
                                files.forEach(file => {
                                    totalBytes += file.size || 0;
                                    const fullPath = path.join(gamePath, file.filename);
                                    let needsDownload = false;

                                    if (!fs.existsSync(fullPath)) {
                                        needsDownload = true;
                                    } else {
                                        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                        if (fileHash !== file.hash) {
                                            needsDownload = true;
                                        }
                                    }

                                    if (needsDownload) {
                                        filesToDownload.push(file);
                                    } else {
                                        downloadedBytes += file.size || 0;
                                    }
                                });                                // İndirilecek dosyaların toplam boyutunu hesapla
                                let remainingBytes = 0;
                                filesToDownload.forEach(file => {
                                    remainingBytes += file.size || 0;
                                });

                                // İlk durum bilgisini gönder
                                mainWindow.webContents.send('progress', {
                                    total: totalFiles,
                                    task: processedFiles,
                                    totalBytes: totalBytes,
                                    downloadedBytes: downloadedBytes,
                                    remainingBytes: remainingBytes,
                                    filesToDownload: filesToDownload.length,
                                    type: 'files',
                                    // Formatlı boyut bilgileri
                                    totalSizeFormatted: formatBytes(totalBytes),
                                    downloadedSizeFormatted: formatBytes(downloadedBytes),
                                    remainingSizeFormatted: formatBytes(remainingBytes),
                                    // Byte tabanlı progress yüzdesi
                                    bytePercentage: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
                                });// files.json'dan dosyaları koruma setine ekle
                                files.forEach(file => filesToKeep.add(path.normalize(file.filename)));

                                // files.json'dan dosyaları işleme
                                files.forEach(file => {
                                    const filename = file.filename;
                                    const expectedHash = file.hash;
                                    const fileSize = file.size || 0;
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
                                    }                                    downloadFile(fileUrl, fullPath, (currentBytes, totalFileBytes) => {
                                        // Progress throttling - sadece belirli aralıklarla güncelle
                                        const now = Date.now();
                                        if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) {
                                            return; // Çok erken, güncellemeyi atla
                                        }
                                        lastProgressUpdate = now;
                                        
                                        // Gerçek zamanlı progress güncellemesi
                                        const currentFileProgress = (currentBytes / totalFileBytes) * fileSize;
                                        const realTimeDownloadedBytes = downloadedBytes + currentFileProgress;
                                        
                                        mainWindow.webContents.send('progress', {
                                            total: totalFiles,
                                            task: processedFiles,
                                            totalBytes: totalBytes,
                                            downloadedBytes: realTimeDownloadedBytes,
                                            remainingBytes: totalBytes - realTimeDownloadedBytes,
                                            filesToDownload: filesToDownload.length,
                                            type: 'files',
                                            currentFile: filename,
                                            // Formatlı boyut bilgileri
                                            totalSizeFormatted: formatBytes(totalBytes),
                                            downloadedSizeFormatted: formatBytes(realTimeDownloadedBytes),
                                            remainingSizeFormatted: formatBytes(totalBytes - realTimeDownloadedBytes),
                                            // Byte tabanlı progress yüzdesi
                                            bytePercentage: totalBytes > 0 ? (realTimeDownloadedBytes / totalBytes) * 100 : 0
                                        });
                                    }).then(() => {
                                        const downloadedFileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                                        if (downloadedFileHash !== expectedHash) {
                                            console.log(`${filename} dosyası için indirme sonrası hash uyumsuzluğu.`);
                                        } else {
                                            console.log(`${filename} dosyası başarıyla indirildi ve güncel.`);
                                        }
                                        downloadedBytes += fileSize;
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
                                }                                function checkProgress() {
                                    // Kalan dosya boyutunu doğru hesapla
                                    const currentRemainingBytes = totalBytes - downloadedBytes;

                                    mainWindow.webContents.send('progress', {
                                        total: totalFiles,
                                        task: processedFiles,
                                        totalBytes: totalBytes,
                                        downloadedBytes: downloadedBytes,
                                        remainingBytes: currentRemainingBytes,
                                        filesToDownload: filesToDownload.length,
                                        type: 'files',
                                        // Formatlı boyut bilgileri
                                        totalSizeFormatted: formatBytes(totalBytes),
                                        downloadedSizeFormatted: formatBytes(downloadedBytes),
                                        remainingSizeFormatted: formatBytes(currentRemainingBytes),
                                        // Byte tabanlı progress yüzdesi
                                        bytePercentage: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0
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
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (onProgress && totalBytes) {
                    onProgress(downloadedBytes, totalBytes);
                }
            });

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
        try {
            const child = spawn(executablePath, [], { 
                detached: true, 
                stdio: 'ignore',
                cwd: gamePath // Set working directory to game path
            });
            
            child.unref();
            console.log('Valheim başarıyla başlatıldı');
            
            // Wait a bit before quitting to ensure game starts properly
            setTimeout(() => {
                console.log('Launcher kapatılıyor...');
                app.quit();
            }, 5000); // Wait 5 seconds before closing launcher
            
        } catch (error) {
            console.error('Valheim başlatılırken hata oluştu:', error);
            mainWindow.webContents.send('error', 'Valheim başlatılırken hata oluştu: ' + error.message);
        }
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
                    let totalUpdateSize = 0;
                    let filesToUpdate = 0;
                    
                    for (const file of files) {
                        const fullPath = path.join(gamePath, file.filename);
                        
                        if (!fs.existsSync(fullPath)) {
                            needsUpdate = true;
                            totalUpdateSize += file.size || 0;
                            filesToUpdate++;
                            continue;
                        }
                        
                        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
                        if (fileHash !== file.hash) {
                            needsUpdate = true;
                            totalUpdateSize += file.size || 0;
                            filesToUpdate++;
                        }
                    }
                      resolve({ 
                        needsUpdate, 
                        updateSize: totalUpdateSize,
                        filesToUpdate: filesToUpdate,
                        totalFiles: files.length,
                        // Formatlı boyut bilgileri
                        updateSizeFormatted: formatBytes(totalUpdateSize)
                    });
                } catch (error) {
                    resolve({ needsUpdate: true, updateSize: 0, filesToUpdate: 0, totalFiles: 0 }); // Hata durumunda güncelleme gerekiyor varsay
                }
            });
        }).on('error', () => {
            resolve({ needsUpdate: true, updateSize: 0, filesToUpdate: 0, totalFiles: 0 }); // Hata durumunda güncelleme gerekiyor varsay
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
        // Önce Steam kontrolü yap
        const steamRunning = await checkSteamRunning();
        if (!steamRunning) {
            return { 
                success: false, 
                error: 'Steam çalışmıyor! Lütfen önce Steam\'i başlatın.' 
            };
        }
        
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
        const updateInfo = await checkForUpdates();
        return updateInfo;
    } catch (error) {
        return { needsUpdate: true, updateSize: 0, filesToUpdate: 0, totalFiles: 0 };
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

// Steam kontrol fonksiyonu
function checkSteamRunning() {
    return new Promise((resolve) => {
        if (os.platform() !== 'win32') {
            // Windows dışı platformlar için şimdilik true döndür
            resolve(true);
            return;
        }
        
        exec('tasklist /FI "IMAGENAME eq steam.exe" /FO CSV /NH', (error, stdout, stderr) => {
            if (error) {
                console.error('Steam kontrol hatası:', error);
                resolve(false);
                return;
            }
            
            // Steam.exe çalışıyor mu kontrol et
            const steamRunning = stdout.includes('steam.exe');
            resolve(steamRunning);
        });
    });
}
