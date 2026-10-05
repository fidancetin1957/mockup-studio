// src/state.js
export const state = {
  // 1. Grafik Tasarım (PNG) - En Üstte
  designImage: null,
  designName: '',

  // 2. Mockup & Kütüphane Sistemi (IndexedDB)
  generatedBgImage: null,
  activeMockupId: null,
  activeBgIndex: 0,
  currentFolderId: 'preset_ready',
  currentFolder: null,
  folders: [],
  previousFolderBackup: null,

  // 3. Kumaş & Yerleşim Ayarları (Otomatik & Akıllı)
  scale: 35,
  posX: 0,
  posY: 0,
  rotation: 0,
  opacity: 100, // 0 - 100%
  wrinkleStrength: 60, // 0 - 100% Kumaş Kıvrım Doygunluğu (Python Shader)
  printType: 'dtg-light', // Geriye dönük uyumluluk

  // İnteraktif Sürükle-Bırak & Bounding Box
  isDragging: false,
  dragMode: null, // 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate'
  dragStartX: 0,
  dragStartY: 0,
  initialDragState: null,
  showTransformBox: true,

  // Kırmızı Kare (Baskı Kılavuzu & Haritalama)
  showPrintGuide: false,
  isMappingMode: false,
  mappingBox: {
    x: 0,
    y: -80,
    width: 350,
    height: 460
  },

  // 4. Dışa Aktarma (Export)
  exportScale: '3x', // '2x' (2000px), '3x' (3000px 300 DPI), '4x' (4000px 4K), '5x' (5000px Master)
  exportFormat: 'png', // 'png', 'webp', 'jpeg'

  // API Key Havuzu (SEO Modülü İçin - Google Gemini)
  apiKeys: ['', '', ''],
  activeApiKeyIndex: 0,

  // Görsel Çizim Motoru (BYOK / Opsiyonel)
  imageProvider: 'fal', // 'fal' (FLUX.1), 'imagen3' (Google), 'openai' (DALL-E 3), 'ideogram'
  imageApiKeys: {
    fal: '',
    imagen3: '',
    openai: '',
    ideogram: ''
  },

  // Teşhis Bilgisi
  bgResolutionText: ''
};

// API Keyleri LocalStorage'dan yükle
try {
  const savedKeys = localStorage.getItem('mockup_api_keys');
  if (savedKeys) {
    const parsed = JSON.parse(savedKeys);
    if (Array.isArray(parsed) && parsed.length > 0) {
      state.apiKeys = parsed;
    }
  }

  const savedImageKeys = localStorage.getItem('mockup_image_api_keys');
  if (savedImageKeys) {
    const parsedImg = JSON.parse(savedImageKeys);
    if (parsedImg && typeof parsedImg === 'object') {
      state.imageApiKeys = { ...state.imageApiKeys, ...parsedImg };
    }
  }

  const savedProvider = localStorage.getItem('mockup_image_provider');
  if (savedProvider) {
    state.imageProvider = savedProvider;
  }
} catch (e) {
  console.error("API keys loading failed", e);
}

