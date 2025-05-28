const { ipcRenderer } = require('electron');

const updateBtn = document.getElementById('updateBtn');
const playBtn = document.getElementById('playBtn');
const status = document.getElementById('status');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

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
    const percentage = (data.task / data.total) * 100;
    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `Eserler dövülüyor: ${data.task} / ${data.total} ${data.type}`;
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

// App update event listeners
ipcRenderer.on('app-update-checking', () => {
    console.log('Checking for app updates...');
});

ipcRenderer.on('app-update-available', (event, info) => {
    appUpdateAvailable = true;
    showAppUpdateNotification('Uygulama güncellemesi mevcut!', `Yeni sürüm: ${info.version}`);
});

ipcRenderer.on('app-update-not-available', () => {
    console.log('App is up to date');
});

ipcRenderer.on('app-update-error', (event, error) => {
    showAppUpdateNotification('Güncelleme hatası', `Hata: ${error}`, 'error');
});

ipcRenderer.on('app-update-download-progress', (event, progressObj) => {
    const percent = Math.round(progressObj.percent);
    showAppUpdateNotification('Güncelleme indiriliyor...', `${percent}% tamamlandı`);
});

ipcRenderer.on('app-update-downloaded', (event, info) => {
    appUpdateDownloaded = true;
    showAppUpdateNotification('Güncelleme hazır!', 'Yeniden başlatmak için tıklayın', 'success', true);
});

// Function to show app update notifications
function showAppUpdateNotification(title, message, type = 'info', clickToInstall = false) {
    // Remove existing notification
    const existingNotification = document.querySelector('.app-update-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = `app-update-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
            ${clickToInstall ? '<div class="notification-action">Yüklemek için tıklayın</div>' : ''}
        </div>
    `;
    
    if (clickToInstall) {
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', async () => {
            await ipcRenderer.invoke('install-app-update');
        });
    }
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds unless it's clickable
    if (!clickToInstall) {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
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
    
    // Güncelleme kontrolü
    status.innerHTML = '<span class="status-icon">🔍</span><span>Güncellemeler kontrol ediliyor...</span>';
    
    const result = await ipcRenderer.invoke('check-updates');
    
    if (result.needsUpdate) {
        status.innerHTML = '<span class="status-icon">⚡</span><span>Savaşa hazır</span>';
        progressText.textContent = 'Yolculuğunuza başlamak için Oyna\'ya tıklayın';
        updateBtn.style.display = 'flex'; // Güncelleme butonunu göster
    } else {
        status.innerHTML = '<span class="status-icon">✅</span><span>Oyun güncel</span>';
        progressText.textContent = 'Doğrudan oyuna girebilirsiniz!';
        updateBtn.style.display = 'none'; // Güncelleme butonunu gizle
        playBtn.innerHTML = '<span class="icon">⚔️</span><span>Valheim\'e Gir</span>';
    }
    
    // Add app update check
    setTimeout(async () => {
        await ipcRenderer.invoke('check-app-updates');
    }, 2000);
});
