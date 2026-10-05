// src/library-db.js
const DB_NAME = 'MockupStudioPOD_DB';
const DB_VERSION = 2; // Version bumped for presets
const STORE_NAME = 'mockupFolders';

let db = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject(event.target.error);

    request.onsuccess = (event) => {
      db = event.target.result;
      ensurePresetFolders().then(() => resolve(db)).catch(() => resolve(db));
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME, { keyPath: 'folderId' });
      }
    };
  });
}

// Hazır Mockup Şablonları (Stüdyo Kalitesinde Canvas Mockup Zeminleri)
function createPresetMockupDataUrl(title, colorHex, isDark = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');

  // Arka Plan (Doğal Stüdyo Zemin)
  ctx.fillStyle = '#EBE7DF'; // Oatmeal Beige
  ctx.fillRect(0, 0, 1200, 1200);

  // Hafif Zemin Dokusu
  ctx.fillStyle = 'rgba(0,0,0,0.02)';
  for (let i = 0; i < 1200; i += 8) {
    ctx.fillRect(0, i, 1200, 2);
  }

  // Tişört Silueti / Şekli (Gerçekçi Tişört Katmanı)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 20;

  ctx.fillStyle = colorHex;
  ctx.beginPath();
  // Yaka ve Omuzlar
  ctx.moveTo(460, 220);
  ctx.quadraticCurveTo(600, 280, 740, 220); // Yaka açıklığı
  ctx.lineTo(960, 340); // Sağ kol
  ctx.lineTo(880, 480);
  ctx.lineTo(800, 430);
  ctx.lineTo(820, 1020); // Sağ etek
  ctx.lineTo(380, 1020); // Sol etek
  ctx.lineTo(400, 430);
  ctx.lineTo(320, 480);
  ctx.lineTo(240, 340); // Sol kol
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Yaka Ribanası Detayı
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(600, 220, 120, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // Kumaş Kıvrımları (Göğüs ve Yan Gölgeler)
  const grad = ctx.createLinearGradient(350, 400, 850, 800);
  grad.addColorStop(0, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.04)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Etiket / Marka Yazısı (Sol Üst)
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText(title, 40, 60);

  ctx.font = '14px Inter, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('⭐ Hazır Stüdyo Mockup Şablonu (300 DPI)', 40, 88);

  return canvas.toDataURL('image/png');
}

async function ensurePresetFolders() {
  const folders = await getAllFolders();
  let presetFolder = folders.find(f => f.folderId === 'preset_ready');

  if (!presetFolder || !presetFolder.images || presetFolder.images.length === 0) {
    const readyImages = [
      {
        id: 'ready_cc1717_pepper',
        name: 'CC1717 Vintage Pepper (Füme Siyah)',
        dataUrl: createPresetMockupDataUrl('Comfort Colors 1717 - Pepper Black', '#26282B', true),
        mapData: { scale: 36, posX: 0, posY: -80, rotation: 0, opacity: 100, blendMode: 'normal' }
      },
      {
        id: 'ready_cc1717_white',
        name: 'CC1717 White (Saf Beyaz)',
        dataUrl: createPresetMockupDataUrl('Comfort Colors 1717 - White Tee', '#F8F9FA', false),
        mapData: { scale: 36, posX: 0, posY: -80, rotation: 0, opacity: 100, blendMode: 'multiply' }
      },
      {
        id: 'ready_cc1717_sand',
        name: 'CC1717 Sand (Bej / Vizon)',
        dataUrl: createPresetMockupDataUrl('Comfort Colors 1717 - Sand Beige', '#D5C7B3', false),
        mapData: { scale: 36, posX: 0, posY: -80, rotation: 0, opacity: 100, blendMode: 'multiply' }
      },
      {
        id: 'ready_gildan_sportgrey',
        name: 'Gildan 18000 Sport Grey (Melanj Gri)',
        dataUrl: createPresetMockupDataUrl('Gildan 18000 - Sport Grey Sweatshirt', '#C5C7CA', false),
        mapData: { scale: 38, posX: 0, posY: -70, rotation: 0, opacity: 100, blendMode: 'multiply' }
      },
      {
        id: 'ready_gildan_navy',
        name: 'Gildan 64000 Navy Blue (Koyu Lacivert)',
        dataUrl: createPresetMockupDataUrl('Gildan 64000 - Navy Blue', '#1A233A', true),
        mapData: { scale: 36, posX: 0, posY: -80, rotation: 0, opacity: 100, blendMode: 'normal' }
      }
    ];

    await saveFolder('preset_ready', '⭐ Hazır Stüdyo Mockupları (5 Renk)', readyImages);
  }
}

export function saveFolder(folderId, name, images = []) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ folderId, name, images, updatedAt: Date.now() });
    
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export function deleteFolder(folderId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(folderId);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getFolder(folderId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(folderId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export function getAllFolders() {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}
