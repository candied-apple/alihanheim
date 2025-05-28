const { ipcRenderer } = require('electron');

const updateBtn = document.getElementById('updateBtn');
const playBtn = document.getElementById('playBtn');
const status = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// Boyut formatlama fonksiyonu
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Oynat butonu tıklandığında - güncelle sonra oyunu başlat
playBtn.addEventListener('click', async () => {
    playBtn.disabled = true;
    updateBtn.disabled = true;
    
    const result = await ipcRenderer.invoke('play-game');
    
    if (!result.success) {
        status.innerHTML = '<span class="status-icon">💀</span><span>Oyun başlatılamadı</span>';
        progressText.textContent = `Hata: ${result.error}`;
        playBtn.disabled = false;
        updateBtn.disabled = false;
    }
    // Başarılıysa, oyun başladıktan sonra uygulama kapanacak
});

// Manuel güncelleme butonu
updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true;
    playBtn.disabled = true;
    
    const result = await ipcRenderer.invoke('update-files');
    
    if (result.success) {
        status.innerHTML = '<span class="status-icon">✅</span><span>Güncelleme tamamlandı!</span>';
        progressText.textContent = 'Artık oynamaya hazırsınız!';
        playBtn.disabled = false;
        updateBtn.disabled = false;
    } else {
        status.innerHTML = '<span class="status-icon">❌</span><span>Güncelleme başarısız</span>';
        progressText.textContent = `Güncelleme hatası: ${result.error}`;
        updateBtn.disabled = false;
        playBtn.disabled = false;
    }
});

// Güncelleme olaylarını işle
ipcRenderer.on('update-started', () => {
    status.innerHTML = '<span class="status-icon">⚡</span><span>Savaşa hazırlanıyor...</span>';
    document.querySelector('.status-card').classList.add('updating');
    progressBar.style.width = '0%';
    progressText.textContent = 'Norse eserleri toplanıyor...';
});

ipcRenderer.on('update-completed', () => {
    status.innerHTML = '<span class="status-icon">⚔️</span><span>Valhalla\'ya hazır!</span>';
    document.querySelector('.status-card').classList.remove('updating');
    progressBar.style.width = '100%';
    progressText.textContent = 'Yolculuğunuz bekliyor, Viking!';
});

ipcRenderer.on('update-failed', (event, error) => {
    status.innerHTML = '<span class="status-icon">⚠️</span><span>Tanrılar memnun değil</span>';
    document.querySelector('.status-card').classList.remove('updating');
    progressText.textContent = `Hata: ${error}`;
    playBtn.disabled = false;
    updateBtn.disabled = false;
});

ipcRenderer.on('progress', (event, data) => {
    // Byte tabanlı progress yüzdesini kullan
    const percentage = data.bytePercentage !== undefined ? data.bytePercentage : (data.task / data.total) * 100;
    progressBar.style.width = `${percentage}%`;
    
    // Yeni formatlı boyut bilgilerini kullan
    if (data.totalSizeFormatted && data.downloadedSizeFormatted !== undefined) {
        if (data.filesToDownload > 0) {
            progressText.textContent = `Norse eserleri dövülüyor: ${data.task}/${data.total} dosya | ${data.downloadedSizeFormatted}/${data.totalSizeFormatted} | Kalan: ${data.remainingSizeFormatted}`;
        } else {
            progressText.textContent = `Tüm eserler hazır: ${data.totalSizeFormatted} | Valhalla'ya hazır!`;
        }
    } else if (data.totalBytes && data.downloadedBytes !== undefined) {
        // Fallback: eski format
        const totalSize = formatBytes(data.totalBytes);
        const downloadedSize = formatBytes(data.downloadedBytes);
        const remainingSize = formatBytes(data.totalBytes - data.downloadedBytes);
        
        if (data.filesToDownload > 0) {
            progressText.textContent = `Norse eserleri dövülüyor: ${data.task}/${data.total} dosya | ${downloadedSize}/${totalSize} | Kalan: ${remainingSize}`;
        } else {
            progressText.textContent = `Tüm eserler hazır: ${totalSize} | Valhalla'ya hazır!`;
        }
    } else {
        // Son fallback: sadece dosya sayısı
        progressText.textContent = `Eserler dövülüyor: ${data.task} / ${data.total} ${data.type}`;
    }
});

ipcRenderer.on('error', (event, message) => {
    status.innerHTML = '<span class="status-icon">💀</span><span>Ragnarök yaklaşıyor</span>';
    progressText.textContent = `Hata: ${message}`;
    playBtn.disabled = false;
    updateBtn.disabled = false;
});

// App update variables
let appUpdateAvailable = false;
let appUpdateDownloaded = false;
let isCheckingAppUpdates = false;
let isDownloadingAppUpdate = false;

// App update event listeners
ipcRenderer.on('app-update-checking', () => {
    console.log('Checking for app updates...');
    isCheckingAppUpdates = true;
    status.innerHTML = '<span class="status-icon">🔄</span><span>Uygulama güncellemeleri kontrol ediliyor...</span>';
    progressText.textContent = 'Launcher güncellemeleri aranıyor...';
    progressBar.style.width = '0%';
});

ipcRenderer.on('app-update-available', (event, info) => {
    appUpdateAvailable = true;
    isCheckingAppUpdates = false;
    isDownloadingAppUpdate = true;
    status.innerHTML = '<span class="status-icon">⬇️</span><span>Uygulama güncellemesi indiriliyor...</span>';
    progressText.textContent = `Yeni sürüm ${info.version} indiriliyor...`;
    progressBar.style.width = '0%';
});

ipcRenderer.on('app-update-not-available', () => {
    console.log('App is up to date or in development mode');
    isCheckingAppUpdates = false;
    isDownloadingAppUpdate = false;
    // Proceed to check game updates
    checkGameUpdates();
});

ipcRenderer.on('app-update-error', (event, error) => {
    console.log('App update error:', error);
    isCheckingAppUpdates = false;
    isDownloadingAppUpdate = false;
    // Proceed to check game updates despite app update error
    checkGameUpdates();
});

ipcRenderer.on('app-update-download-progress', (event, progressObj) => {
    if (isDownloadingAppUpdate) {
        const percent = Math.round(progressObj.percent);
        progressBar.style.width = `${percent}%`;
        const downloaded = formatBytes(progressObj.transferred);
        const total = formatBytes(progressObj.total);
        progressText.textContent = `Uygulama güncellemesi: ${percent}% | ${downloaded}/${total}`;
    }
});

ipcRenderer.on('app-update-downloaded', (event, info) => {
    appUpdateDownloaded = true;
    isDownloadingAppUpdate = false;
    status.innerHTML = '<span class="status-icon">🔄</span><span>Güncelleme yeniden başlatılıyor...</span>';
    progressBar.style.width = '100%';
    progressText.textContent = 'Güncelleme tamamlandı, yeniden başlatılıyor...';
    
    // Auto-install after 2 seconds
    setTimeout(async () => {
        await ipcRenderer.invoke('install-app-update');
    }, 2000);
});

// Function to check game updates
async function checkGameUpdates() {
    status.innerHTML = '<span class="status-icon">🔍</span><span>Oyun güncellemeleri kontrol ediliyor...</span>';
    progressText.textContent = 'Norse veri tabanı kontrol ediliyor...';
    progressBar.style.width = '0%';
    
    const result = await ipcRenderer.invoke('check-updates');
    
    if (result.needsUpdate) {
        status.innerHTML = '<span class="status-icon">⚡</span><span>Savaşa hazır</span>';
        
        if (result.updateSizeFormatted) {
            progressText.textContent = `${result.filesToUpdate} dosya güncellenmeli (${result.updateSizeFormatted}) - Oyna'ya tıklayın`;
        } else if (result.updateSize > 0) {
            const updateSize = formatBytes(result.updateSize);
            progressText.textContent = `${result.filesToUpdate} dosya güncellenmeli (${updateSize}) - Oyna'ya tıklayın`;
        } else {
            progressText.textContent = `${result.filesToUpdate} dosya güncellenmeli - Oyna'ya tıklayın`;
        }
        updateBtn.style.display = 'flex';
    } else {
        status.innerHTML = '<span class="status-icon">✅</span><span>Oyun güncel</span>';
        progressText.textContent = 'Doğrudan oyuna girebilirsiniz!';
        updateBtn.style.display = 'none';
        playBtn.innerHTML = '<span class="icon">⚔️</span><span>Valheim\'e Gir</span>';
    }
}

// Sayfa yüklendiğinde güncelleme kontrolü yap
window.addEventListener('DOMContentLoaded', async () => {
    const savedImage = localStorage.getItem('mainImage');
    if (savedImage) {
        mainImage.src = savedImage;
        mainImage.style.display = 'block';
        mainImagePlaceholder.style.display = 'none';
    }
    
    // Start with app update check - game updates will be checked after app updates are done
    status.innerHTML = '<span class="status-icon">🔄</span><span>Başlatılıyor...</span>';
    progressText.textContent = 'Uygulama başlatılıyor...';
    progressBar.style.width = '0%';
});
