// src/main.js
import '../style.css';
import { state } from './state.js';
import { 
  initCanvas, 
  renderCanvas, 
  registerSliderSync, 
  downloadCurrentMockup,
  renderHighResBlob
} from './canvas-engine.js';
import { 
  initDB, 
  saveFolder, 
  getFolder, 
  getAllFolders, 
  deleteFolder 
} from './library-db.js';
import { 
  updateResolutionBadge, 
  updateApiBadgeUI 
} from './ui.js';

// -------------------------------------------------------------
// APP INITIALIZATION & KLAVYE OK TUŞLARI İLE HIZLI ÖNİZLEME
// -------------------------------------------------------------
async function initApp() {
  registerSliderSync(syncSlidersFromState);
  initCanvas();
  updateResolutionBadge();
  updateApiBadgeUI();
  setupDropzones();
  setupKeyboardNavigation();

  try {
    await initDB();
    
    // Klasör Hafızası
    const lastFolder = localStorage.getItem('lastFolderId');
    if (lastFolder) state.currentFolderId = lastFolder;
    
    await refreshFolderDropdown();

    // PNG Grafik Hafızası
    const recentDesign = await getFolder('recent_design_memory');
    if (recentDesign && recentDesign.images && recentDesign.images.length > 0) {
      const imgObj = new Image();
      imgObj.onload = () => {
        state.designImage = imgObj;
        state.designName = recentDesign.images[0].name || 'Hatırlanan Tasarım';
        updateDesignDropzoneUI();
        renderCanvas();
      };
      imgObj.src = recentDesign.images[0].dataUrl;
    } else {
      updateDesignDropzoneUI();
    }
  } catch (err) {
    console.error("IndexedDB Başlatılamadı:", err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// 🌟 KLAVYE SOL/SAĞ OKLARI İLE MOCKUPLARI HIZLICA GEZME 🌟
function setupKeyboardNavigation() {
  window.addEventListener('keydown', (e) => {
    // Inputlara yazı yazılıyorsa tuşları engelleme
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    // Ctrl+Z veya Cmd+Z ile Geri Alma
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (state.previousFolderBackup) {
        window.undoLastSeal();
      } else {
        window.resetDesignTransform();
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextMockupPreview();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      prevMockupPreview();
    }
  });
}

window.nextMockupPreview = function() {
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) return;
  const nextIdx = (state.activeBgIndex + 1) % state.currentFolder.images.length;
  selectMockupImage(state.currentFolder.images[nextIdx], nextIdx);
};

window.prevMockupPreview = function() {
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) return;
  const total = state.currentFolder.images.length;
  const prevIdx = (state.activeBgIndex - 1 + total) % total;
  selectMockupImage(state.currentFolder.images[prevIdx], prevIdx);
};

// -------------------------------------------------------------
// KLASÖR & KÜTÜPHANE YÖNETİMİ
// -------------------------------------------------------------
export async function refreshFolderDropdown() {
  const folders = await getAllFolders();
  const select = document.getElementById('folder-select');
  if (!select) return;

  select.innerHTML = '';
  folders.forEach(f => {
    if (f.folderId === 'recent_design_memory') return; // Sistem klasörünü UI'dan gizle
    const opt = document.createElement('option');
    opt.value = f.folderId;
    const isPreset = f.folderId === 'preset_ready';
    opt.textContent = isPreset ? `⚡ ${f.name}` : `📁 ${f.name} (${f.images ? f.images.length : 0})`;
    select.appendChild(opt);
  });

  if (folders.length > 0) {
    const activeId = state.currentFolderId && folders.some(f => f.folderId === state.currentFolderId)
      ? state.currentFolderId
      : folders[0].folderId;
    
    select.value = activeId;
    await loadFolder(activeId);
  }
}

window.onFolderChange = async function(folderId) {
  await loadFolder(folderId);
};

export async function loadFolder(folderId) {
  state.currentFolderId = folderId;
  localStorage.setItem('lastFolderId', folderId);
  const folder = await getFolder(folderId);
  state.currentFolder = folder;

  const delBtn = document.getElementById('btn-delete-folder');
  if (delBtn) {
    delBtn.style.display = folderId === 'preset_ready' ? 'none' : 'flex';
  }

  renderThumbnails(folder ? folder.images : []);

  if (folder && folder.images && folder.images.length > 0) {
    selectMockupImage(folder.images[0], 0);
  } else {
    state.generatedBgImage = null;
    state.activeMockupId = null;
    renderCanvas();
  }
}

// -------------------------------------------------------------
// 🌟 MEDIAPIPE POSE & OTOMATİK HİZALAMA 🌟
// -------------------------------------------------------------
let globalPoseModel = null;

async function initPoseModel() {
  if (globalPoseModel) return globalPoseModel;
  
  if (typeof Pose === 'undefined') {
    alert("MediaPipe Pose kütüphanesi yüklenemedi. Lütfen internet bağlantınızı kontrol edin.");
    throw new Error("Pose undefined");
  }

  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.2,
    minTrackingConfidence: 0.2
  });

  await pose.initialize();
  globalPoseModel = pose;
  return pose;
}

window.startAutoAlignment = async function() {
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) {
    alert("Lütfen önce içinde mockup olan bir klasör seçin veya yükleyin.");
    return;
  }
  
  const btn = document.querySelector('.wizard-start-btn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Yükleniyor...';
  
  try {
    const pose = await initPoseModel();
    
    let detectedCount = 0;

    // Klasördeki tüm resimleri tarayalım
    for (let i = 0; i < state.currentFolder.images.length; i++) {
      const imgData = state.currentFolder.images[i];
      btn.innerHTML = `⏳ Analiz: ${i + 1}/${state.currentFolder.images.length}`;
      
      await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imgData.dataUrl || imgData.url || imgData.path;
        
        img.onload = async () => {
          pose.onResults((results) => {
            if (results.poseLandmarks && results.poseLandmarks.length >= 25) {
              detectedCount++;
              const lm = results.poseLandmarks;
              const cvsW = 1000;
              const cvsH = 1000;
              
              const lsPx = { x: lm[11].x * cvsW, y: lm[11].y * cvsH };
              const rsPx = { x: lm[12].x * cvsW, y: lm[12].y * cvsH };
              const lhPx = { x: lm[23].x * cvsW, y: lm[23].y * cvsH };
              const rhPx = { x: lm[24].x * cvsW, y: lm[24].y * cvsH };

              const shoulderDist = Math.hypot(lsPx.x - rsPx.x, lsPx.y - rsPx.y);
              const collarX = (lsPx.x + rsPx.x) / 2;
              const collarY = (lsPx.y + rsPx.y) / 2;
              
              const hipX = (lhPx.x + rhPx.x) / 2;
              const hipY = (lhPx.y + rhPx.y) / 2;
              
              const spineDx = hipX - collarX;
              const spineDy = hipY - collarY;
              const spineRad = Math.atan2(spineDy, spineDx);
              const tiltDeg = (spineRad - Math.PI/2) * (180 / Math.PI);
              
              // Kutu Oranları (Omuzun %70'i)
              const scaleFactor = 0.70;
              const boxW = Math.round(shoulderDist * scaleFactor);
              const boxH = Math.round(boxW * 1.30);
              
              // Merkez noktası (Yaka altı)
              const topMargin = shoulderDist * 0.14;
              const boxCenterDist = topMargin + (boxH / 2);
              
              const boxCenterX = collarX + Math.cos(spineRad) * boxCenterDist;
              const boxCenterY = collarY + Math.sin(spineRad) * boxCenterDist;
              
              if (!imgData.mapData) imgData.mapData = {};
              
              // Mevcut arayüzün kaydırıcı standartlarına eşleştirme
              imgData.mapData.boxX = boxCenterX - (cvsW / 2);
              imgData.mapData.boxY = boxCenterY - (cvsH / 2);
              imgData.mapData.boxWidth = boxW;
              imgData.mapData.boxHeight = boxH;
              imgData.mapData.rotation = tiltDeg;
              imgData.mapData.posX = 0; // İnce ayarı sıfırla
              imgData.mapData.posY = 0; // İnce ayarı sıfırla
              
              // Yaka noktası (Manuel override için saklıyoruz)
              imgData.mapData.collarPx = { x: collarX, y: collarY };
              imgData.mapData.shoulderDist = shoulderDist;
              imgData.mapData.spineRad = spineRad;
            }
            resolve();
          });
          
          await pose.send({ image: img });
        };
        img.onerror = () => resolve();
      });
    }
    
    // Veritabanına kaydet
    await saveFolder(state.currentFolderId, state.currentFolder.name, state.currentFolder.images);
    renderThumbnails(state.currentFolder.images);
    
    // UI Güncelle
    if (detectedCount === 0) {
      alert(`ℹ️ Bu klasördeki (${state.currentFolder.images.length}) görselde canlı manken (insan pozu) tespit edilemedi.\n\nDüz yatay (Flatlay), askı veya mankensiz tişörtler için lütfen 1. görselde kırmızı kutuyu göğse ayarlayıp üst bardaki '📋 Bu Konumu Tüm Klasöre Mühürle' butonuna tıklayın. Tüm seriye anında uygulanacaktır.`);
    } else {
      alert(`🎉 Harika! '${state.currentFolder.name}' klasöründeki ${detectedCount} / ${state.currentFolder.images.length} manken başarıyla otomatik hizalandı!`);
    }
    
    // Seçili resmi yeniden yükle
    if (state.currentFolder.images[state.activeBgIndex]) {
      selectMockupImage(state.currentFolder.images[state.activeBgIndex], state.activeBgIndex);
    }
    
  } catch (err) {
    console.error(err);
    alert("Otomatik hizalama sırasında bir hata oluştu: " + err.message);
  } finally {
    btn.innerHTML = originalText;
  }
};

let isCollarTargetingActive = false;
let currentTargetingHandler = null;

window.toggleManualCollarTargeting = function() {
  const canvas = document.getElementById('previewCanvas');
  const btn = document.getElementById('btn-target-collar');
  
  if (!canvas || !btn || !state.currentFolder || !state.currentFolder.images[state.activeBgIndex]) {
    alert("Lütfen önce bir mockup seçin ve Otomatik Hizalama uygulayın.");
    return;
  }
  
  const imgData = state.currentFolder.images[state.activeBgIndex];
  if (!imgData.mapData || imgData.mapData.spineRad === undefined) {
    alert("Bu resimde omurga ekseni bulunmuyor. Önce '✨ Otomatik Hizala' yapmalısınız.");
    return;
  }
  
  // Tıklama modu açıksa, KAPAT
  if (isCollarTargetingActive) {
    isCollarTargetingActive = false;
    canvas.style.cursor = 'default';
    btn.innerHTML = '🎯 Yakayı İşaretle';
    btn.style.background = '#FF0077';
    if (currentTargetingHandler) {
      canvas.removeEventListener('mousedown', currentTargetingHandler);
      currentTargetingHandler = null;
    }
    return;
  }
  
  // Tıklama modu kapalıysa, AÇ
  isCollarTargetingActive = true;
  canvas.style.cursor = 'crosshair';
  btn.innerHTML = '✅ Tıklama Modu Açık (Kapatmak İçin Tıkla)';
  btn.style.background = '#10B981';
  btn.style.color = '#fff';
  
  currentTargetingHandler = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    
    // Yeni yaka noktası ile Kutuyu (Box) yeniden hesapla
    const spineRad = imgData.mapData.spineRad;
    const shoulderDist = imgData.mapData.shoulderDist;
    const boxW = imgData.mapData.boxWidth;
    const boxH = imgData.mapData.boxHeight;
    
    const topMargin = shoulderDist * 0.14;
    const boxCenterDist = topMargin + (boxH / 2);
    
    const boxCenterX = clickX + Math.cos(spineRad) * boxCenterDist;
    const boxCenterY = clickY + Math.sin(spineRad) * boxCenterDist;
    
    imgData.mapData.boxX = boxCenterX - (canvas.width / 2);
    imgData.mapData.boxY = boxCenterY - (canvas.height / 2);
    imgData.mapData.collarPx = { x: clickX, y: clickY }; // Yaka güncellendi
    imgData.mapData.posX = 0; // İnce ayarı sıfırla
    imgData.mapData.posY = 0;
    
    // State güncelle
    state.mappingBox.x = imgData.mapData.boxX;
    state.mappingBox.y = imgData.mapData.boxY;
    state.posX = 0;
    state.posY = 0;
    
    // UI Güncelle
    document.getElementById('input-posX').value = 0;
    document.getElementById('input-posY').value = 0;
    document.getElementById('val-posX').innerText = '0 px';
    document.getElementById('val-posY').innerText = '0 px';
    
    // Kaydet ve Render Et
    saveFolder(state.currentFolderId, state.currentFolder.name, state.currentFolder.images);
    renderCanvas();
    
    // NOT: Tıklama özelliği açık kalıyor, kullanıcı yanlış tıkladıysa tekrar tıklayıp düzeltebilir!
  };
  
  canvas.addEventListener('mousedown', currentTargetingHandler);
};

// -------------------------------------------------------------
// 🌟 HARİTALAMA SİHİRBAZI (KAYDET VE GEÇ FLOW) 🌟
// -------------------------------------------------------------
window.startMappingWizard = function() {
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) {
    alert("Lütfen önce içinde mockup olan bir klasör seçin veya yükleyin.");
    return;
  }

  state.isMappingMode = true;
  state.showPrintGuide = true;

  const wizardBar = document.getElementById('mapping-wizard-bar');
  if (wizardBar) wizardBar.classList.add('active');

  selectMockupImage(state.currentFolder.images[0], 0);
  updateWizardStepText();
  renderCanvas();
};

function updateWizardStepText() {
  const stepText = document.getElementById('wizard-step-text');
  if (!stepText || !state.currentFolder) return;
  const currentNum = state.activeBgIndex + 1;
  const total = state.currentFolder.images.length;
  const currentImg = state.currentFolder.images[state.activeBgIndex];
  const name = currentImg ? (currentImg.name || `Mockup ${currentNum}`) : '';
  stepText.innerText = `📍 Haritalama: Mockup ${currentNum} / ${total} (${name.substring(0, 24)})`;
}

window.saveAndNextMockup = async function() {
  if (!state.currentFolder || !state.currentFolder.images) return;

  const currentIndex = state.activeBgIndex;
  const currentImage = state.currentFolder.images[currentIndex];
  if (!currentImage) return;

  currentImage.mapData = {
    ...(currentImage.mapData || {}),
    posX: state.posX,
    posY: state.posY,
    scale: state.scale,
    rotation: state.rotation,
    opacity: state.opacity,
    printType: state.printType,
    wrinkleStrength: state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90,
    boxX: state.mappingBox.x,
    boxY: state.mappingBox.y,
    boxWidth: state.mappingBox.width,
    boxHeight: state.mappingBox.height
  };

  await saveFolder(state.currentFolderId, state.currentFolder.name, state.currentFolder.images);
  renderThumbnails(state.currentFolder.images);

  if (currentIndex < state.currentFolder.images.length - 1) {
    const nextIndex = currentIndex + 1;
    selectMockupImage(state.currentFolder.images[nextIndex], nextIndex);
    updateWizardStepText();
  } else {
    alert(`🎉 Harika! '${state.currentFolder.name}' klasöründeki tüm (${state.currentFolder.images.length}) mockuplar başarıyla haritalandı ve kalıcı olarak kaydedildi.`);
    window.closeMappingWizard();
  }
};

window.applyToAllAndFinish = async function() {
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) return;

  // 🌟 Geri Alma Yedeği (Undo Snapshot) Al 🌟
  state.previousFolderBackup = JSON.parse(JSON.stringify(state.currentFolder.images));

  const currentCoords = {
    posX: state.posX,
    posY: state.posY,
    scale: state.scale,
    rotation: state.rotation,
    opacity: state.opacity,
    printType: state.printType,
    wrinkleStrength: state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90,
    boxX: state.mappingBox.x,
    boxY: state.mappingBox.y,
    boxWidth: state.mappingBox.width,
    boxHeight: state.mappingBox.height
  };

  const updatedImages = state.currentFolder.images.map(img => ({
    ...img,
    mapData: {
      ...(img.mapData || {}),
      ...currentCoords
    }
  }));

  state.currentFolder.images = updatedImages;
  await saveFolder(state.currentFolderId, state.currentFolder.name, updatedImages);

  // Arka plan profile servisine kalıcı JSON kaydı (Permanence Standard)
  try {
    fetch('/api/save_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_name: state.currentFolder.name,
        box: {
          x: Math.round(500 + currentCoords.boxX - currentCoords.boxWidth / 2),
          y: Math.round(500 + currentCoords.boxY - currentCoords.boxHeight / 2),
          w: currentCoords.boxWidth,
          h: currentCoords.boxHeight,
          rot: currentCoords.rotation
        },
        settings: currentCoords
      })
    }).catch(() => {});
  } catch (e) {}

  // Canlı thumbnail şeridini yeni referanslarla güncelle (Stale closure engelleme)
  renderThumbnails(updatedImages);

  // Aktif görseli mühürlü koordinatlarla yeniden yükle
  if (updatedImages[state.activeBgIndex]) {
    selectMockupImage(updatedImages[state.activeBgIndex], state.activeBgIndex);
  }

  // Geri Al butonunu görünür kıl
  const undoBtn = document.getElementById('btn-undo-seal');
  if (undoBtn) undoBtn.style.display = 'inline-block';

  alert(`✅ Şu anki tüm yerleşim ve kumaş ayarları '${state.currentFolder.name}' klasöründeki TÜM (${updatedImages.length}) mockuplara mühürlendi!\n\n(İsterseniz üst bardaki '↩️ Geri Al' butonuyla veya Ctrl+Z ile önceki duruma dönebilirsiniz.)`);
  window.closeMappingWizard();
};

window.undoLastSeal = async function() {
  if (!state.previousFolderBackup || state.previousFolderBackup.length === 0) {
    alert("Geri alınacak önceki bir mühürleme kaydı bulunamadı.");
    return;
  }

  const restoredImages = JSON.parse(JSON.stringify(state.previousFolderBackup));
  state.currentFolder.images = restoredImages;
  await saveFolder(state.currentFolderId, state.currentFolder.name, restoredImages);
  renderThumbnails(restoredImages);

  if (restoredImages[state.activeBgIndex]) {
    selectMockupImage(restoredImages[state.activeBgIndex], state.activeBgIndex);
  }

  state.previousFolderBackup = null;
  const undoBtn = document.getElementById('btn-undo-seal');
  if (undoBtn) undoBtn.style.display = 'none';

  alert("↩️ Son yapılan mühürleme işlemi başarıyla geri alındı ve önceki tüm konumlar geri yüklendi!");
};

window.closeMappingWizard = function() {
  state.isMappingMode = false;
  state.showPrintGuide = false;
  const wizardBar = document.getElementById('mapping-wizard-bar');
  if (wizardBar) wizardBar.classList.remove('active');
  renderCanvas();
};

// -------------------------------------------------------------
// KLASÖR OLUŞTURMA & PC YÜKLEME
// -------------------------------------------------------------
window.triggerPcFolderUpload = function() {
  const input = document.getElementById('pc-folder-input');
  if (input) {
    input.value = '';
    input.click();
  }
};

window.deleteCurrentFolder = async function() {
  if (!state.currentFolderId || state.currentFolderId === 'preset_ready') return;

  if (confirm(`'${state.currentFolder?.name}' klasörünü ve içindeki tüm mockupları silmek istediğinize emin misiniz?`)) {
    await deleteFolder(state.currentFolderId);
    state.currentFolderId = 'preset_ready';
    await refreshFolderDropdown();
  }
};

// -------------------------------------------------------------
// THUMBNAIL ŞERİDİ
// -------------------------------------------------------------
function renderThumbnails(images = []) {
  const container = document.getElementById('mockup-thumbnails');
  if (!container) return;

  container.innerHTML = '';
  if (images.length === 0) {
    container.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:8px 0;">Bu klasörde henüz mockup yok.</span>';
    return;
  }

  images.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'thumb-item' + (state.activeMockupId === img.id ? ' active' : '');
    
    const imgEl = document.createElement('img');
    imgEl.src = img.dataUrl;
    imgEl.alt = img.name || 'Mockup';

    const delBtn = document.createElement('button');
    delBtn.className = 'thumb-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Mockupı Sil';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMockupFromFolder(img.id);
    };

    item.appendChild(imgEl);
    if (state.currentFolderId !== 'preset_ready') {
      item.appendChild(delBtn);
    }

    // Stale closure tuzağını kır: daima dizideki güncel canlı referansı al
    item.onclick = () => {
      const liveImg = (state.currentFolder && state.currentFolder.images && state.currentFolder.images[idx]) || img;
      selectMockupImage(liveImg, idx);
    };
    container.appendChild(item);
  });
}

function selectMockupImage(imgData, index) {
  if (!imgData) return;
  // Daima canlı dizi referansından çek (Eski kapatma nesnesine güvenme)
  const liveImg = (state.currentFolder && state.currentFolder.images && state.currentFolder.images[index]) || imgData;
  state.activeMockupId = liveImg.id;
  state.activeBgIndex = index;

  const items = document.querySelectorAll('.thumb-item');
  items.forEach((it, i) => it.classList.toggle('active', i === index));
  
  // Her zaman sihirbaz çubuğunu göster
  const wizardBar = document.getElementById('mapping-wizard-bar');
  if (wizardBar) {
    wizardBar.classList.add('active');
    updateWizardStepText();
  }

  if (liveImg.mapData) {
    const md = liveImg.mapData;
    state.scale = md.scale ?? 35;
    state.posX = md.posX ?? 0;
    state.posY = md.posY ?? 0;
    state.rotation = md.rotation ?? 0;
    state.opacity = md.opacity ?? 100;
    state.wrinkleStrength = md.wrinkleStrength ?? 90;
    state.printType = md.printType || 'dtg';

    state.mappingBox = {
      x: md.boxX ?? 0,
      y: md.boxY ?? (md.posY !== undefined && md.posY !== 0 && md.posY !== -80 ? md.posY : -10),
      width: md.boxWidth ?? Math.round(1000 * (state.scale / 100)),
      height: md.boxHeight ?? Math.round((md.boxWidth ?? (1000 * (state.scale / 100))) * 1.31)
    };

    syncSlidersFromState();
  } else {
    state.scale = 35;
    state.posX = 0;
    state.posY = 0;
    state.rotation = 0;
    state.opacity = 100;
    state.wrinkleStrength = 90;
    state.printType = 'dtg';
    state.mappingBox = { x: 0, y: -10, width: 350, height: 460 };
    syncSlidersFromState();
  }

  const imageObj = new Image();
  imageObj.onload = () => {
    state.generatedBgImage = imageObj;
    renderCanvas();
  };
  imageObj.src = liveImg.dataUrl;
}

async function deleteMockupFromFolder(imgId) {
  if (!state.currentFolder) return;
  const filtered = state.currentFolder.images.filter(img => img.id !== imgId);
  await saveFolder(state.currentFolderId, state.currentFolder.name, filtered);
  await loadFolder(state.currentFolderId);
  await refreshFolderDropdown();
}

// -------------------------------------------------------------
// SÜRÜKLE-BIRAK VE DOSYA YÜKLEME (DROPZONES)
// -------------------------------------------------------------
function setupDropzones() {
  const designDrop = document.getElementById('design-dropzone');
  const designInput = document.getElementById('design-file-input');

  if (designDrop && designInput) {
    designDrop.onclick = () => {
      designInput.value = '';
      designInput.click();
    };
    designDrop.ondragover = (e) => {
      e.preventDefault();
      designDrop.style.borderColor = '#6366F1';
    };
    designDrop.ondragleave = () => {
      designDrop.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    };
    designDrop.ondrop = (e) => {
      e.preventDefault();
      designDrop.style.borderColor = 'rgba(99, 102, 241, 0.4)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleDesignFile(e.dataTransfer.files[0]);
      }
    };
    designInput.onchange = (e) => {
      if (e.target && e.target.files && e.target.files.length) {
        handleDesignFile(e.target.files[0]);
      }
    };
  }

  const mockupDrop = document.getElementById('mockup-dropzone');
  const mockupInput = document.getElementById('mockup-file-input');

  if (mockupDrop && mockupInput) {
    mockupDrop.onclick = () => {
      mockupInput.value = '';
      mockupInput.click();
    };
    mockupDrop.ondragover = (e) => {
      e.preventDefault();
      mockupDrop.style.borderColor = '#6366F1';
    };
    mockupDrop.ondragleave = () => {
      mockupDrop.style.borderColor = 'rgba(99, 102, 241, 0.3)';
    };
    mockupDrop.ondrop = (e) => {
      e.preventDefault();
      mockupDrop.style.borderColor = 'rgba(99, 102, 241, 0.3)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleMockupFiles(e.dataTransfer.files);
      }
    };
    mockupInput.onchange = (e) => {
      if (e.target && e.target.files && e.target.files.length) {
        handleMockupFiles(e.target.files);
      }
    };
  }

  const pcFolderInput = document.getElementById('pc-folder-input');
  if (pcFolderInput) {
    pcFolderInput.onchange = (e) => {
      if (e.target && e.target.files && e.target.files.length) {
        handlePcFolderFiles(e.target.files);
      }
    };
  }
}

async function handlePcFolderFiles(files) {
  if (!files || files.length === 0) return;

  const firstPath = files[0].webkitRelativePath || '';
  const folderName = firstPath.split('/')[0] || `Yüklenen Mockup Seti (${new Date().toLocaleDateString()})`;
  const folderId = 'folder_' + Date.now();

  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(f.name));
  if (imageFiles.length === 0) {
    alert("Seçtiğiniz klasörde uygun görsel bulunamadı (PNG, JPG veya WEBP olmalı).");
    return;
  }

  const loadedImages = [];
  for (let file of imageFiles) {
    const dataUrl = await readFileAsDataUrl(file);
    loadedImages.push({
      id: 'mockup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: file.name,
      dataUrl: dataUrl,
      mapData: {
        scale: 35,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 100,
        wrinkleStrength: 90,
        printType: 'dtg',
        boxX: 0,
        boxY: -10,
        boxWidth: 350,
        boxHeight: 460
      }
    });
  }

  await saveFolder(folderId, folderName, loadedImages);
  state.currentFolderId = folderId;
  await refreshFolderDropdown();
  alert(`✅ '${folderName}' klasöründen ${loadedImages.length} adet mockup başarıyla yüklendi!`);
}

async function handleMockupFiles(files) {
  let targetFolderId = state.currentFolderId;
  if (!targetFolderId || targetFolderId === 'preset_ready') {
    targetFolderId = 'folder_' + Date.now();
    await saveFolder(targetFolderId, 'Kişisel Mockup Setim', []);
  }

  const folder = await getFolder(targetFolderId);
  const currentImages = [...((folder && folder.images) || [])];

  for (let file of files) {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) continue;
    const dataUrl = await readFileAsDataUrl(file);
    currentImages.push({
      id: 'mockup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: file.name,
      dataUrl: dataUrl,
      mapData: {
        scale: 35,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 100,
        wrinkleStrength: 90,
        printType: 'dtg',
        boxX: 0,
        boxY: -10,
        boxWidth: 350,
        boxHeight: 460
      }
    });
  }

  const fName = (folder && folder.name) || 'Kişisel Mockup Setim';
  await saveFolder(targetFolderId, fName, currentImages);
  state.currentFolderId = targetFolderId;
  await loadFolder(targetFolderId);
  await refreshFolderDropdown();
}

async function handleDesignFile(file) {
  if (!file) return;
  const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(file.name);
  if (!isImg) {
    alert("Lütfen geçerli bir görsel dosyası seçin (PNG, WebP, JPG veya SVG).");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    
    // Hafızaya kaydet
    await saveFolder('recent_design_memory', 'Son Tasarım Hafızası', [{
      id: 'recent_design',
      name: file.name,
      dataUrl: dataUrl
    }]);

    const imgObj = new Image();
    imgObj.onload = () => {
      state.designImage = imgObj;
      state.designName = file.name;
      updateDesignDropzoneUI();
      
      syncSlidersFromState();
      renderCanvas();
    };
    imgObj.onerror = (e) => {
      console.error("Görsel yüklenemedi:", e);
      alert("Görsel dosyası okunamadı. Lütfen geçerli bir PNG veya JPG seçin.");
    };
    imgObj.src = dataUrl;
  } catch (err) {
    console.error("handleDesignFile hata:", err);
    alert("Dosya yüklenirken bir hata oluştu.");
  }
}

export function updateDesignDropzoneUI() {
  const drop = document.getElementById('design-dropzone');
  if (!drop) return;

  if (state.designImage && state.designImage.src) {
    drop.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;">
        <img src="${state.designImage.src}" style="width: 52px; height: 52px; object-fit: contain; background: repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 10px 10px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.4); padding: 2px;">
        <div style="overflow: hidden; flex: 1;">
          <span style="font-weight: 600; font-size: 13px; color: var(--text-main); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${state.designName || 'Grafik Tasarım'}</span>
          <small style="color: var(--accent-green); font-size: 11px; display: block; margin-top: 2px;">✓ Aktif Tasarım • Değiştirmek için tıkla</small>
        </div>
      </div>
    `;
  } else {
    drop.innerHTML = `
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px; margin-bottom: 4px;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
      </svg>
      <span id="design-upload-text">Şeffaf Tasarım Dosyasını Yükle</span>
      <small>PNG, WebP, JPG veya SVG formatı</small>
    `;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

// -------------------------------------------------------------
// KUMAŞ & YERLEŞİM KONTROLLERİ
// -------------------------------------------------------------
export function syncSlidersFromState() {
  const inScale = document.getElementById('input-scale');
  const inPosX = document.getElementById('input-posX');
  const inPosY = document.getElementById('input-posY');
  const inRot = document.getElementById('input-rotation');
  const inOpac = document.getElementById('input-opacity');
  const inWrinkle = document.getElementById('input-wrinkle');

  if (inScale) inScale.value = state.scale;
  if (inPosX) inPosX.value = state.posX;
  if (inPosY) inPosY.value = state.posY;
  if (inRot) inRot.value = state.rotation;
  if (inOpac) inOpac.value = state.opacity;
  if (inWrinkle) inWrinkle.value = state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90;

  const valScale = document.getElementById('val-scale');
  const valPosX = document.getElementById('val-posX');
  const valPosY = document.getElementById('val-posY');
  const valRot = document.getElementById('val-rotation');
  const valOpac = document.getElementById('val-opacity');
  const valWrinkle = document.getElementById('val-wrinkle');

  if (valScale) valScale.value = state.scale;
  if (valPosX) valPosX.value = state.posX;
  if (valPosY) valPosY.value = state.posY;
  if (valRot) valRot.value = state.rotation;
  if (valOpac) valOpac.value = state.opacity;
  if (valWrinkle) valWrinkle.value = (state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90);
  
  const inPrintType = document.getElementById('select-print-type');
  if (inPrintType) {
    inPrintType.value = state.printType || 'dtg';
  }
}

window.syncManualInput = function(type, val) {
  const v = parseInt(val) || 0;
  if (type === 'scale') document.getElementById('input-scale').value = v;
  if (type === 'posX') document.getElementById('input-posX').value = v;
  if (type === 'posY') document.getElementById('input-posY').value = v;
  if (type === 'rotation') document.getElementById('input-rotation').value = v;
  if (type === 'opacity') document.getElementById('input-opacity').value = v;
  if (type === 'wrinkle') document.getElementById('input-wrinkle').value = v;
  updateSlidersFromUI();
};

export function syncActiveMockupMapData() {
  if (state.currentFolder && state.currentFolder.images && state.currentFolder.images[state.activeBgIndex]) {
    const cur = state.currentFolder.images[state.activeBgIndex];
    if (!cur.mapData) cur.mapData = {};
    cur.mapData.scale = state.scale;
    cur.mapData.posX = state.posX;
    cur.mapData.posY = state.posY;
    cur.mapData.rotation = state.rotation;
    cur.mapData.opacity = state.opacity;
    cur.mapData.wrinkleStrength = state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90;
    cur.mapData.printType = state.printType || 'dtg';
    cur.mapData.boxX = state.mappingBox.x;
    cur.mapData.boxY = state.mappingBox.y;
    cur.mapData.boxWidth = state.mappingBox.width;
    cur.mapData.boxHeight = state.mappingBox.height;
  }
}

window.updateSlidersFromUI = function() {
  state.scale = parseInt(document.getElementById('input-scale')?.value) || 35;
  state.posX = parseInt(document.getElementById('input-posX')?.value) || 0;
  state.posY = parseInt(document.getElementById('input-posY')?.value) || 0;
  state.rotation = parseInt(document.getElementById('input-rotation')?.value) || 0;
  state.opacity = parseInt(document.getElementById('input-opacity')?.value) || 100;
  state.wrinkleStrength = parseInt(document.getElementById('input-wrinkle')?.value) || 90;
  
  const inPrintType = document.getElementById('select-print-type');
  if (inPrintType) {
    state.printType = inPrintType.value || 'dtg';
  }

  state.mappingBox.width = Math.round(1000 * (state.scale / 100));
  state.mappingBox.height = Math.round(state.mappingBox.width * 1.31);

  syncActiveMockupMapData();
  syncSlidersFromState();
  renderCanvas();
};

window.centerDesign = function() {
  state.posX = 0;
  state.posY = 0;
  syncActiveMockupMapData();
  syncSlidersFromState();
  renderCanvas();
};

window.resetDesignTransform = function() {
  state.scale = 35;
  state.posX = 0;
  state.posY = 0;
  state.rotation = 0;
  state.opacity = 100;
  state.wrinkleStrength = 90;
  state.mappingBox = { x: 0, y: -10, width: 350, height: 460 };
  syncActiveMockupMapData();
  syncSlidersFromState();
  renderCanvas();
};

window.removeDesign = async function() {
  state.designImage = null;
  state.designName = '';
  updateDesignDropzoneUI();
  
  const designInput = document.getElementById('design-file-input');
  if (designInput) designInput.value = '';

  try {
    await deleteFolder('recent_design_memory');
  } catch (e) {
    console.error("Design memory clear error:", e);
  }

  renderCanvas();
};

window.toggleTransformBox = function() {
  state.showTransformBox = !state.showTransformBox;
  const btn = document.getElementById('btn-toggle-box');
  if (btn) {
    btn.innerText = state.showTransformBox ? 'Çerçeve: Açık' : 'Çerçeve: Gizli';
    btn.style.color = state.showTransformBox ? 'var(--text-main)' : 'var(--accent-red)';
  }
  renderCanvas();
};

window.togglePrintGuide = function() {
  state.showPrintGuide = !state.showPrintGuide;
  const btn = document.getElementById('btn-toggle-guide');
  if (btn) {
    btn.innerText = state.showPrintGuide ? 'Kılavuz: Açık' : 'Kılavuz: Gizli';
    btn.style.color = state.showPrintGuide ? 'var(--text-main)' : 'var(--accent-red)';
  }
  renderCanvas();
};


window.toggleGridOverlay = function() {
  const overlay = document.getElementById('grid-overlay');
  const btn = document.getElementById('grid-btn');
  if (overlay && btn) {
    overlay.classList.toggle('active');
    btn.classList.toggle('active');
  }
};

window.setExportScale = function(scale) {
  state.exportScale = scale;
  const group = document.getElementById('export-scale-group');
  if (group) {
    group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(`scale-${scale}`);
    if (active) active.classList.add('active');
  }
  updateResolutionBadge();
};

window.setExportFormat = function(format) {
  state.exportFormat = format;
  const group = document.getElementById('export-format-group');
  if (group) {
    group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(`format-${format}`);
    if (active) active.classList.add('active');
  }
  updateResolutionBadge();
};

// -------------------------------------------------------------
// 🚀 TEK TIKLA TOPLU MOCKUP ÜRETİMİ (300 DPI BATCH RENDER)
// -------------------------------------------------------------
window.downloadCurrentMockup = downloadCurrentMockup;

window.batchRenderAllFolder = async function() {
  if (!state.designImage) {
    alert("Lütfen önce 1. Karttan bir PNG grafik tasarımı yükleyin.");
    return;
  }
  if (!state.currentFolder || !state.currentFolder.images || state.currentFolder.images.length === 0) {
    alert("Seçili klasörde mockup fotoğrafı bulunmuyor.");
    return;
  }

  const loader = document.getElementById('batch-loader');
  const progressText = document.getElementById('loader-progress');
  if (loader) loader.classList.add('active');

  const total = state.currentFolder.images.length;
  const multiplierMap = { '2x': 2, '3x': 3, '4x': 4, '5x': 5 };
  const mult = multiplierMap[state.exportScale] || 3;
  const ext = state.exportFormat === 'jpeg' ? 'jpg' : state.exportFormat;

  let zip = null;
  if (typeof JSZip !== 'undefined') {
    zip = new JSZip();
  }

  for (let i = 0; i < total; i++) {
    if (progressText) progressText.innerText = `${i + 1} / ${total} Üretiliyor...`;

    const imgData = state.currentFolder.images[i];
    
    // YENİ: coords objesini kanvas motorunun beklediği formata (mappingBox ile) çeviriyoruz
    const coords = {
      posX: imgData.mapData?.posX ?? state.posX,
      posY: imgData.mapData?.posY ?? state.posY,
      scale: imgData.mapData?.scale ?? state.scale,
      rotation: imgData.mapData?.rotation ?? state.rotation,
      opacity: imgData.mapData?.opacity ?? state.opacity,
      printType: imgData.mapData?.printType ?? state.printType,
      wrinkleStrength: imgData.mapData?.wrinkleStrength ?? state.wrinkleStrength,
      mappingBox: {
        x: imgData.mapData?.boxX ?? state.mappingBox.x,
        y: imgData.mapData?.boxY ?? state.mappingBox.y,
        width: imgData.mapData?.boxWidth ?? state.mappingBox.width,
        height: imgData.mapData?.boxHeight ?? state.mappingBox.height
      }
    };

    const bgImg = await new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = imgData.dataUrl;
    });

    const blob = await renderHighResBlob(
      bgImg,
      state.designImage,
      coords,
      state.exportFormat,
      mult
    );

    const fileName = `${(imgData.name || `Mockup_${i + 1}`).replace(/\.[^/.]+$/, "")}_300DPI.${ext}`;

    if (zip) {
      zip.file(fileName, blob);
    } else {
      // Fallback: JSZip yoksa tek tek indir
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    }
  }
  
  if (zip) {
    if (progressText) progressText.innerText = `ZIP Dosyası Sıkıştırılıyor... Lütfen Bekleyin`;
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = `${state.currentFolder.name || 'Mockups'}_300DPI.zip`;
    link.click();
    URL.revokeObjectURL(zipUrl);
  }

  if (loader) loader.classList.remove('active');
  alert(`🎉 Harika! '${state.currentFolder.name}' klasöründeki ${total} adet mockup 300 DPI süper çözünürlükle başarıyla üretildi ve indirildi.`);
};

// -------------------------------------------------------------
// API & AI MOTORLARI YÖNETİMİ (GEMINI SEO + GÖRSEL ÇİZİM BYOK)
// -------------------------------------------------------------
window.activeApiTab = 'gemini';

window.toggleApiPopover = function() {
  const popover = document.getElementById('api-popover');
  if (!popover) return;
  popover.classList.toggle('active');
  if (popover.classList.contains('active')) {
    renderApiKeys();
    syncImageProviderUI();
  }
};

window.switchApiTab = function(tabName) {
  window.activeApiTab = tabName;
  const btnGemini = document.getElementById('tab-btn-gemini');
  const btnImage = document.getElementById('tab-btn-image');
  const contentGemini = document.getElementById('tab-content-gemini');
  const contentImage = document.getElementById('tab-content-image');

  if (tabName === 'gemini') {
    btnGemini?.classList.add('active');
    btnImage?.classList.remove('active');
    contentGemini?.classList.add('active');
    contentImage?.classList.remove('active');
    renderApiKeys();
  } else {
    btnGemini?.classList.remove('active');
    btnImage?.classList.add('active');
    contentGemini?.classList.remove('active');
    contentImage?.classList.add('active');
    syncImageProviderUI();
  }
};

function renderApiKeys() {
  const container = document.getElementById('api-keys-container');
  if (!container) return;
  container.innerHTML = '';

  state.apiKeys.forEach((key, index) => {
    const row = document.createElement('div');
    row.className = 'api-key-row';

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'api-key-input';
    input.placeholder = `Google Gemini Key #${index + 1} (AIzaSy...)`;
    input.value = key;
    input.onchange = (e) => saveApiKey(index, e.target.value);

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-action-btn delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Keyi Sil';
    delBtn.onclick = () => removeApiKeyRow(index);

    row.appendChild(input);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

window.addNewApiKeyRow = function() {
  state.apiKeys.push('');
  saveAllApiKeys();
  renderApiKeys();
};

function removeApiKeyRow(index) {
  state.apiKeys.splice(index, 1);
  if (state.apiKeys.length === 0) state.apiKeys.push('');
  saveAllApiKeys();
  renderApiKeys();
}

function saveApiKey(index, value) {
  state.apiKeys[index] = value.trim();
  saveAllApiKeys();
}

function saveAllApiKeys() {
  localStorage.setItem('mockup_api_keys', JSON.stringify(state.apiKeys));
  updateApiBadgeUI();
}

// Görsel Sağlayıcı Değişimi & UI Senkronu
window.onImageProviderChange = function(provider) {
  state.imageProvider = provider;
  localStorage.setItem('mockup_image_provider', provider);
  syncImageProviderUI();
};

function syncImageProviderUI() {
  const provider = state.imageProvider || 'fal';
  const select = document.getElementById('image-provider-select');
  if (select) select.value = provider;

  const label = document.getElementById('image-key-label');
  const input = document.getElementById('image-api-key-input');
  const costCard = document.getElementById('provider-cost-card');

  const configs = {
    fal: {
      label: 'Fal.ai API Key (fal_...)',
      placeholder: 'fal_xxxxxxxxxxxxxxxxxxxx',
      cost: 'Fal.ai Kullandıkça Öde',
      desc: 'FLUX.1 modeli: Dünyanın en gerçekçi insan & tişört kumaş dokusu. Ücret doğrudan Fal.ai hesabınızdan düşer.'
    },
    imagen3: {
      label: 'Google AI Studio API Key (AIzaSy...)',
      placeholder: 'AIzaSyxxxxxxxxxxxxxxxxxxxx',
      cost: 'Google AI Studio Tarifesi',
      desc: 'Google Imagen 3: Foto-gerçekçi stüdyo aydınlatması ve doğal pozlar. Google faturalandırmanıza bağlıdır.'
    },
    openai: {
      label: 'OpenAI API Key (sk-...)',
      placeholder: 'sk-proj-xxxxxxxxxxxxxxxxxxxx',
      cost: 'OpenAI API Tarifesi',
      desc: 'DALL-E 3 & GPT-4o: Yaratıcı kompozisyonlar ve genel dijital çizim.'
    },
    ideogram: {
      label: 'Ideogram API Key',
      placeholder: 'ideogram_xxxxxxxxxxxxxxxxxxxx',
      cost: 'Ideogram API Tarifesi',
      desc: 'Ideogram 2.0: Tişört tipografisi ve yazı basmada dünyanın en hatasız modeli.'
    }
  };

  const conf = configs[provider] || configs.fal;
  if (label) label.innerText = conf.label;
  if (input) {
    input.placeholder = conf.placeholder;
    input.value = state.imageApiKeys[provider] || '';
  }
  if (costCard) {
    costCard.innerHTML = `
      <div class="cost-badge">${conf.cost}</div>
      <div class="cost-desc">${conf.desc}</div>
    `;
  }
  updateApiBadgeUI();
  if (typeof window.updateMockupProviderStatusUI === 'function') window.updateMockupProviderStatusUI();
  if (typeof window.updateDesignProviderStatusUI === 'function') window.updateDesignProviderStatusUI();
}

window.saveImageApiKey = function(value) {
  const provider = state.imageProvider || 'fal';
  state.imageApiKeys[provider] = value.trim();
  localStorage.setItem('mockup_image_api_keys', JSON.stringify(state.imageApiKeys));
  updateApiBadgeUI();
  if (typeof window.updateMockupProviderStatusUI === 'function') window.updateMockupProviderStatusUI();
  if (typeof window.updateDesignProviderStatusUI === 'function') window.updateDesignProviderStatusUI();
};

window.saveImageApiKeyFromInput = function() {
  const input = document.getElementById('image-api-key-input');
  if (input) {
    window.saveImageApiKey(input.value);
    alert(`✓ ${state.imageProvider.toUpperCase()} API anahtarınız tarayıcınıza güvenle kaydedildi.`);
  }
};

// Sayfa ilk yüklendiğinde rozeti güncelle
setTimeout(updateApiBadgeUI, 300);

// -------------------------------------------------------------
// SLAYT REHBERİ (WALKTHROUGH MODAL ENGINE)
// -------------------------------------------------------------
const GUIDE_DATA = {
  gemini: {
    title: "Google Gemini API Anahtarı Nasıl Alınır? (Ücretsiz)",
    icon: "🟢",
    slides: [
      {
        step: 1,
        title: "Adım 1: Google AI Studio'ya Giriş Yapın",
        desc: "Google AI Studio, Google'ın geliştiricilere ücretsiz Gemini API kotası sağladığı resmi platformdur. Tarayıcınızdan Google hesabınızla oturum açın.",
        link: "https://aistudio.google.com",
        linkText: "Google AI Studio'yu Aç (Yeni Sekme)",
        tag: "Giriş ve Konsol Ekranı",
        sub: "Ekran görüntüsü eklendiğinde Google AI Studio ana sayfası burada görünecek",
        img: ""
      },
      {
        step: 2,
        title: "Adım 2: 'Get API Key' Menüsüne Tıklayın",
        desc: "Sol menüde veya sağ üstte yer alan mavi 'Get API Key' butonuna basın. Ardından 'Create API key in new project' seçeneğini seçin.",
        link: "https://aistudio.google.com/app/apikey",
        linkText: "Doğrudan API Key Sayfasına Git",
        tag: "API Key Oluşturma Penceresi",
        sub: "Ekran görüntüsü eklendiğinde 'Get API Key' paneli burada görünecek",
        img: ""
      },
      {
        step: 3,
        title: "Adım 3: Anahtarı Kopyalayıp Panelinize Yapıştırın",
        desc: "'AIzaSy...' ile başlayan anahtarınızı kopyalayın. Mockup Studio'daki 'Gemini Key Ekle' alanına yapıştırıp kaydedin. SEO etiketleme motorunuz sınırsız ve ücretsiz aktif hale gelecektir.",
        link: "",
        linkText: "",
        tag: "Panele Mühürleme ve Başarı Rozeti",
        sub: "Ekran görüntüsü eklendiğinde başarıyla bağlanan API rozeti burada görünecek",
        img: ""
      }
    ]
  },
  image: {
    title: "Yapay Zeka Görsel Çizim API Anahtarı Nasıl Alınır?",
    icon: "🟣",
    slides: [
      {
        step: 1,
        title: "Adım 1: Fal.ai (FLUX.1) Hesabı Oluşturun",
        desc: "FLUX.1, fotogerçekçi insan ve tişört kumaş dokusu üretiminde dünyada 1 numaradır. Fal.ai platformunda GitHub veya e-posta ile hesap açın.",
        link: "https://fal.ai",
        linkText: "Fal.ai Resmi Sitesini Aç (Yeni Sekme)",
        tag: "Fal.ai Kayıt ve Fiyatlandırma Ekranı",
        sub: "Ekran görüntüsü eklendiğinde Fal.ai kayıt ekranı burada görünecek",
        img: ""
      },
      {
        step: 2,
        title: "Adım 2: Bakiye Yükleyin (Kullandıkça Öde)",
        desc: "Billing (Faturalandırma) menüsünden kartınızla bakiye ekleyin. Kredi/jeton aboneliği değil, doğrudan kullandığınız kadar ödediğiniz şeffaf bir sistemdir.",
        link: "https://fal.ai/dashboard/billing",
        linkText: "Fal.ai Bakiye Yükleme Sayfası",
        tag: "Bakiye Yükleme Ekranı",
        sub: "Ekran görüntüsü eklendiğinde faturalandırma paneli burada görünecek",
        img: ""
      },
      {
        step: 3,
        title: "Adım 3: 'Keys' Bölümünden Anahtarınızı Kopyalayın",
        desc: "Dashboard > API Keys sekmesinden 'Create Key' deyin ve 'fal_...' ile başlayan anahtarınızı kopyalayıp Mockup Studio'daki 'Görsel Çizim' kutusuna yapıştırıp 'Kaydet'e basın.",
        link: "https://fal.ai/dashboard/keys",
        linkText: "Fal.ai API Keys Sayfasına Git",
        tag: "Anahtar Kopyalama ve Panele Mühürleme",
        sub: "Ekran görüntüsü eklendiğinde 'Create Key' butonu burada görünecek",
        img: ""
      }
    ]
  }
};

let currentGuideType = 'gemini';
let currentGuideSlideIndex = 0;

window.openGuideModal = function(type) {
  currentGuideType = type || 'gemini';
  currentGuideSlideIndex = 0;

  const backdrop = document.getElementById('guide-modal-backdrop');
  if (!backdrop) return;

  renderGuideContent();
  backdrop.classList.add('active');
};

window.closeGuideModal = function(event) {
  if (event && event.target && event.target.id !== 'guide-modal-backdrop' && !event.target.classList.contains('icon-close-btn')) {
    return;
  }
  const backdrop = document.getElementById('guide-modal-backdrop');
  if (backdrop) backdrop.classList.remove('active');
};

function renderGuideContent() {
  const guide = GUIDE_DATA[currentGuideType] || GUIDE_DATA.gemini;
  const slide = guide.slides[currentGuideSlideIndex];

  // Başlık & İkon
  const titleText = document.getElementById('guide-title-text');
  const headerIcon = document.getElementById('guide-header-icon');
  if (titleText) titleText.innerText = guide.title;
  if (headerIcon) headerIcon.innerText = guide.icon;

  // Stepper (Adım çipleri)
  const stepper = document.getElementById('guide-stepper');
  if (stepper) {
    stepper.innerHTML = '';
    guide.slides.forEach((s, idx) => {
      const chip = document.createElement('div');
      chip.className = `guide-step-chip ${idx === currentGuideSlideIndex ? 'active' : ''} ${idx < currentGuideSlideIndex ? 'completed' : ''}`;
      chip.innerHTML = `${idx < currentGuideSlideIndex ? '✓' : idx + 1}. Adım`;
      chip.onclick = () => window.goToGuideSlide(idx);
      stepper.appendChild(chip);
    });
  }

  // Resim Alanı / Placeholder
  const placeholderBox = document.getElementById('guide-placeholder-box');
  const screenImg = document.getElementById('guide-screen-img');
  const screenTag = document.getElementById('guide-screen-tag');
  const screenSub = document.getElementById('guide-screen-sub');

  if (slide.img && slide.img.trim().length > 0) {
    if (placeholderBox) placeholderBox.style.display = 'none';
    if (screenImg) {
      screenImg.src = slide.img;
      screenImg.style.display = 'block';
    }
  } else {
    if (placeholderBox) placeholderBox.style.display = 'flex';
    if (screenImg) screenImg.style.display = 'none';
    if (screenTag) screenTag.innerText = slide.tag || 'Ekran Görüntüsü Bekleniyor';
    if (screenSub) screenSub.innerText = slide.sub || 'Ekran görüntüsü eklendiğinde burada gösterilecek';
  }

  // Açıklama & Bağlantı
  const stepTitle = document.getElementById('guide-step-title');
  const stepDesc = document.getElementById('guide-step-desc');
  const linkBox = document.getElementById('guide-link-box');
  const actionLink = document.getElementById('guide-action-link');

  if (stepTitle) stepTitle.innerText = slide.title;
  if (stepDesc) stepDesc.innerText = slide.desc;

  if (actionLink && linkBox) {
    if (slide.link && slide.link.trim().length > 0) {
      actionLink.href = slide.link;
      actionLink.innerText = slide.linkText || 'Bağlantıyı Aç';
      linkBox.style.display = 'block';
    } else {
      linkBox.style.display = 'none';
    }
  }

  // Alt Butonlar & Noktalar (Dots)
  const prevBtn = document.getElementById('guide-prev-btn');
  const nextBtn = document.getElementById('guide-next-btn');
  const dotsContainer = document.getElementById('guide-dots-container');

  if (prevBtn) prevBtn.disabled = currentGuideSlideIndex === 0;
  if (nextBtn) {
    if (currentGuideSlideIndex === guide.slides.length - 1) {
      nextBtn.innerText = 'Tamamla ✓';
    } else {
      nextBtn.innerText = 'Sonraki Adım ▶';
    }
  }

  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    guide.slides.forEach((_, idx) => {
      const dot = document.createElement('div');
      dot.className = `guide-dot ${idx === currentGuideSlideIndex ? 'active' : ''}`;
      dot.onclick = () => window.goToGuideSlide(idx);
      dotsContainer.appendChild(dot);
    });
  }
}

window.prevGuideSlide = function() {
  if (currentGuideSlideIndex > 0) {
    currentGuideSlideIndex--;
    renderGuideContent();
  }
};

window.nextGuideSlide = function() {
  const guide = GUIDE_DATA[currentGuideType] || GUIDE_DATA.gemini;
  if (currentGuideSlideIndex < guide.slides.length - 1) {
    currentGuideSlideIndex++;
    renderGuideContent();
  } else {
    // Son slaytta "Tamamla" denirse modalı kapat ve ilgili taba odaklan
    window.closeGuideModal();
    const popover = document.getElementById('api-popover');
    if (popover && !popover.classList.contains('active')) {
      window.toggleApiPopover();
    }
    window.switchApiTab(currentGuideType);
  }
};

window.goToGuideSlide = function(index) {
  currentGuideSlideIndex = index;
  renderGuideContent();
};

// =============================================================
// KART 1: TARAYICI İÇİ ARKA PLAN SİLME (CLIENT-SIDE WASM / GPU)
// =============================================================
window.removeDesignBackground = async function() {
  if (!state.designImage || !state.designImage.src) {
    alert("⚠️ Lütfen önce Kart 1'den bir grafik tasarım yükleyin veya '✨ AI ile Desen Çiz' butonunu kullanın.");
    const input = document.getElementById('design-file-input');
    if (input) input.click();
    return;
  }

  const btn = document.getElementById('btn-bg-remove');
  const originalText = btn ? btn.innerText : '✂️ Arka Planı Sil';

  try {
    if (btn) {
      btn.innerText = "⏳ Arka Plan Siliniyor...";
      btn.disabled = true;
    }

    // Vercel uyumlu, sıfır sunucu maliyetli tarayıcı içi ISNet WebAssembly motoru
    const { removeBackground } = await import('@imgly/background-removal');
    
    const blob = await removeBackground(state.designImage.src);
    const newUrl = URL.createObjectURL(blob);

    const imgObj = new Image();
    imgObj.onload = async () => {
      state.designImage = imgObj;
      state.designName = (state.designName ? state.designName.replace(/\.[^/.]+$/, "") : "tasarim") + "_transparent.png";
      
      // IndexedDB hafızasını güncelle
      const reader = new FileReader();
      reader.onloadend = async () => {
        await saveFolder('recent_design_memory', 'Son Tasarım Hafızası', [{
          id: 'recent_design',
          name: state.designName,
          dataUrl: reader.result
        }]);
      };
      reader.readAsDataURL(blob);

      updateDesignDropzoneUI();
      renderCanvas();

      if (btn) {
        btn.innerText = "✓ Şeffaf Yapıldı!";
        setTimeout(() => {
          btn.innerText = originalText;
          btn.disabled = false;
        }, 2200);
      }
    };
    imgObj.onerror = () => {
      throw new Error("Şeffaflaştırılan görsel canvasa yüklenemedi.");
    };
    imgObj.src = newUrl;

  } catch (err) {
    console.error("Arka plan silme hatası:", err);
    alert(`Arka plan silinirken bir sorun oluştu: ${err.message || err}`);
    if (btn) {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  }
};

// =============================================================
// AI GÖRSEL ÜRETİM YARDIMCISI (FAL.AI, IMAGEN 3, OPENAI, IDEOGRAM)
// =============================================================
async function fetchImageAsDataUrl(url) {
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("fetchImageAsDataUrl doğrudan çekim başarısız, URL korunuyor:", err);
    return url;
  }
}

async function callAiImageApi(promptText, provider, apiKey, isMockup = false) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error(`${provider.toUpperCase()} API anahtarı bulunamadı. Lütfen üst menüdeki 'AI Motorları & API Havuzu' butonundan anahtarınızı kaydedin.`);
  }

  const key = apiKey.trim();

  // 1. Fal.ai (FLUX.1 Schnell)
  if (provider === 'fal') {
    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: promptText,
        image_size: "square_hd",
        num_inference_steps: 4,
        enable_safety_checker: true
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.detail || `Fal.ai Hatası (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (data.images && data.images.length > 0 && data.images[0].url) {
      return data.images[0].url;
    }
    throw new Error("Fal.ai yanıtında geçerli bir görsel bağlantısı bulunamadı.");
  }

  // 2. Google Imagen 3 (Google AI Studio)
  if (provider === 'imagen3') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [{ prompt: promptText }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
          personGeneration: "ALLOW_ADULT"
        }
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Google Imagen 3 Hatası (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (data.predictions && data.predictions.length > 0 && data.predictions[0].bytesBase64Encoded) {
      return `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}`;
    }
    throw new Error("Google Imagen 3 yanıtında görsel verisi bulunamadı.");
  }

  // 3. OpenAI (DALL-E 3)
  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: promptText,
        n: 1,
        size: "1024x1024"
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `OpenAI Hatası (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (data.data && data.data.length > 0 && data.data[0].url) {
      return data.data[0].url;
    }
    throw new Error("OpenAI yanıtında görsel verisi bulunamadı.");
  }

  // 4. Ideogram 2.0
  if (provider === 'ideogram') {
    const response = await fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: {
        'Api-Key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_request: {
          prompt: promptText,
          aspect_ratio: "ASPECT_1_1",
          model: "V_2"
        }
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Ideogram Hatası (HTTP ${response.status})`);
    }

    const data = await response.json();
    if (data.data && data.data.length > 0 && data.data[0].url) {
      return data.data[0].url;
    }
    throw new Error("Ideogram yanıtında görsel verisi bulunamadı.");
  }

  throw new Error(`Desteklenmeyen sağlayıcı: ${provider}`);
}

// =============================================================
// AI MOCKUP SAHNESİ STÜDYOSU (KART 2 İÇİN)
// =============================================================
let selectedMockupScene = 'cafe';
const MOCKUP_SCENE_TEMPLATES = {
  cafe: "Professional commercial fashion photography of a [MODEL] wearing a blank solid [COLOR] crewneck t-shirt, sitting relaxed at a cozy aesthetic boutique cafe with warm morning sunlight streaming through large glass window, rustic wood tabletop, shallow depth of field, 8k uhd, editorial catalog photography",
  urban: "High fashion street style photography of a [MODEL] wearing a plain solid [COLOR] relaxed fit t-shirt, walking casually on a trendy modern city street, blurred urban architecture backdrop, soft cinematic daylight, realistic fabric folds, lookbook catalog aesthetic",
  nature: "Lifestyle apparel photography of a [MODEL] wearing a clean solid [COLOR] t-shirt, standing outdoors in a lush serene botanical park with warm golden hour sunbeams, rich natural foliage, clean clothing catalog mockup",
  flatlay: "Overhead flat lay product catalog photography of a blank solid [COLOR] cotton t-shirt neatly folded on a rich dark oak wooden textured surface, accompanied by minimalist dried eucalyptus leaves and ceramic cup, clean soft diffused studio lighting, 8k uhd",
  studio: "Clean minimalist commercial studio catalog photography of a [MODEL] wearing a blank solid [COLOR] crewneck t-shirt standing centered against a seamless smooth neutral warm grey studio backdrop, soft balanced studio softbox lighting, high-end lookbook",
  skater: "Dynamic modern youth lifestyle photo of a [MODEL] wearing a blank solid [COLOR] oversized t-shirt at an urban concrete skatepark, natural energetic daylight, crisp natural textile texture and shadows, streetwear brand catalog"
};

const MODEL_LABELS = {
  female: "young woman",
  male: "young man",
  flatlay: "blank t-shirt neatly laid out flat",
  hanger: "blank t-shirt hanging on an aesthetic minimalist wooden hanger"
};

const COLOR_LABELS = {
  white: "crisp white",
  black: "deep black",
  cream: "warm cream beige",
  gray: "dark heather charcoal gray",
  blue: "soft pastel sky blue",
  olive: "earthy olive green"
};

window.selectMockupPreset = function(sceneKey) {
  selectedMockupScene = sceneKey;
  const container = document.getElementById('mockup-scene-presets');
  if (container) {
    container.querySelectorAll('.preset-pill').forEach(btn => {
      if (btn.getAttribute('data-scene') === sceneKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  window.updateMockupPromptFromInputs();
};

window.updateMockupPromptFromInputs = function() {
  const modelVal = document.getElementById('mockup-model-select')?.value || 'female';
  const colorVal = document.getElementById('mockup-color-select')?.value || 'white';
  const template = MOCKUP_SCENE_TEMPLATES[selectedMockupScene] || MOCKUP_SCENE_TEMPLATES.cafe;

  const modelText = MODEL_LABELS[modelVal] || "young woman";
  const colorText = COLOR_LABELS[colorVal] || "white";

  let prompt = template.replace('[MODEL]', modelText).replace('[COLOR]', colorText);
  if (modelVal === 'flatlay' || modelVal === 'hanger') {
    prompt = prompt.replace('wearing a', 'featuring a');
  }

  const textarea = document.getElementById('mockup-prompt-input');
  if (textarea) {
    textarea.value = prompt;
  }
};

window.openAiMockupModal = function() {
  const modal = document.getElementById('ai-mockup-modal-backdrop');
  if (modal) {
    modal.classList.add('active');
    window.updateMockupProviderStatusUI();
    window.updateMockupPromptFromInputs();
  }
};

window.closeAiMockupModal = function() {
  const modal = document.getElementById('ai-mockup-modal-backdrop');
  if (modal) {
    modal.classList.remove('active');
  }
};

window.updateMockupProviderStatusUI = function() {
  const statusBox = document.getElementById('mockup-provider-status');
  if (!statusBox) return;

  const provider = state.imageProvider || 'fal';
  const key = state.imageApiKeys[provider];
  const providerNames = {
    fal: 'Fal.ai (FLUX.1 Schnell)',
    imagen3: 'Google Imagen 3',
    openai: 'OpenAI (DALL-E 3)',
    ideogram: 'Ideogram 2.0'
  };

  const name = providerNames[provider] || provider.toUpperCase();

  if (key && key.trim()) {
    statusBox.innerHTML = `
      <div class="provider-pill-badge">
        <span class="dot"></span>
        <span>Aktif Motor: <strong>${name}</strong> (Hazır)</span>
      </div>
      <button class="sub-btn" style="padding: 3px 8px; font-size: 10px;" onclick="window.toggleApiPopover(); window.switchApiTab('image');">⚙️ Değiştir</button>
    `;
  } else {
    statusBox.innerHTML = `
      <div class="provider-pill-badge">
        <span class="dot warn"></span>
        <span>Motor: <strong>${name}</strong> (API Anahtarı Eksik)</span>
      </div>
      <button class="sub-btn primary" style="padding: 4px 10px; font-size: 10px;" onclick="window.toggleApiPopover(); window.switchApiTab('image');">🔑 Anahtarı Kaydet</button>
    `;
  }
};

window.generateAiMockup = async function() {
  const promptInput = document.getElementById('mockup-prompt-input');
  const prompt = promptInput ? promptInput.value.trim() : '';
  if (!prompt) {
    alert("Lütfen bir mockup sahne promptu girin.");
    return;
  }

  const provider = state.imageProvider || 'fal';
  const apiKey = state.imageApiKeys[provider];

  if (!apiKey || !apiKey.trim()) {
    alert(`⚠️ Lütfen önce üst menüdeki 'AI Motorları & API Havuzu' butonundan ${provider.toUpperCase()} API anahtarınızı kaydedin.`);
    const popover = document.getElementById('api-popover');
    if (popover && !popover.classList.contains('active')) {
      window.toggleApiPopover();
    }
    window.switchApiTab('image');
    return;
  }

  const btn = document.getElementById('btn-generate-mockup');
  const originalText = btn ? btn.innerHTML : '<span>🎨 Mockup Sahnesini Üret</span>';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳ Sahne Üretiliyor (${provider.toUpperCase()})...</span>`;
    }

    const rawUrl = await callAiImageApi(prompt, provider, apiKey, true);
    const dataUrl = await fetchImageAsDataUrl(rawUrl);

    // IndexedDB Kütüphanesine Ekle
    let targetFolderId = state.currentFolderId;
    if (!targetFolderId || targetFolderId === 'preset_ready') {
      targetFolderId = 'ai_generated_folder';
      await saveFolder(targetFolderId, '✨ AI Mockuplarım', []);
    }

    const folder = await getFolder(targetFolderId);
    const currentImages = [...((folder && folder.images) || [])];
    const newImageId = 'ai_mockup_' + Date.now();

    const newMockupItem = {
      id: newImageId,
      name: `AI_${selectedMockupScene}_${Date.now().toString().slice(-4)}.jpg`,
      dataUrl: dataUrl,
      mapData: {
        scale: 35,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 100,
        wrinkleStrength: 90,
        printType: 'dtg',
        boxX: 0,
        boxY: -10,
        boxWidth: 350,
        boxHeight: 460
      }
    };

    currentImages.unshift(newMockupItem);
    const folderName = (folder && folder.name) || '✨ AI Mockuplarım';
    await saveFolder(targetFolderId, folderName, currentImages);
    state.currentFolderId = targetFolderId;
    await loadFolder(targetFolderId);
    await refreshFolderDropdown();

    // Canvas arka planı olarak hemen yükle
    const imgObj = new Image();
    imgObj.onload = () => {
      state.generatedBgImage = imgObj;
      state.activeMockupId = newImageId;
      state.activeBgIndex = 0;
      renderCanvas();
    };
    imgObj.src = dataUrl;

    window.closeAiMockupModal();
    alert(`🎉 Yeni AI mockup sahnesi stüdyonuza başarıyla eklendi!`);

  } catch (err) {
    console.error("generateAiMockup hata:", err);
    alert(`Mockup sahnesi üretilemedi: ${err.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

// =============================================================
// AI GRAFİK DESEN TASARIMCISI (KART 1 İÇİN)
// =============================================================
let selectedDesignStyle = 'vintage';
const DESIGN_STYLE_TEMPLATES = {
  vintage: "Vintage 90s bootleg retro aesthetic graphic illustration of an astronaut cat floating in space among neon planets, distressed weathered screenprint texture, faded vintage color palette, isolated vector art",
  lineart: "Minimalist continuous single line art drawing of a serene botanical woman face with flowers and leaves, elegant modern bohemian aesthetic, clean black vector lines on solid white background",
  mascot: "Cute dynamic retro cartoon mascot sticker of a joyful skateboarding Shiba Inu dog wearing a backward cap, bold black outlines, vibrant pop colors, trendy Japanese streetwear sticker graphic",
  typography: "Vintage athletic heritage typography emblem badge with curved lettering saying 'WILD & FREE VINTAGE CLUB', ornate ribbon banner, distressed grunge finish, retro 70s apparel print style",
  botanical: "Intricate vintage wild mushroom and forest botanical illustration, delicate stippling and linework, aesthetic cottagecore nature t-shirt graphic, muted earthy color palette",
  cyberpunk: "Futuristic cyberpunk neon samurai helmet with glowing electric blue and hot pink lasers, geometric kanji badges, high-tech dystopian synthwave vector artwork"
};

window.selectDesignStylePreset = function(styleKey) {
  selectedDesignStyle = styleKey;
  const container = document.getElementById('design-style-presets');
  if (container) {
    container.querySelectorAll('.preset-pill').forEach(btn => {
      if (btn.getAttribute('data-style') === styleKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  const textarea = document.getElementById('design-prompt-input');
  if (textarea) {
    textarea.value = DESIGN_STYLE_TEMPLATES[styleKey] || DESIGN_STYLE_TEMPLATES.vintage;
  }
};

window.openAiDesignModal = function() {
  const modal = document.getElementById('ai-design-modal-backdrop');
  if (modal) {
    modal.classList.add('active');
    window.updateDesignProviderStatusUI();
    const textarea = document.getElementById('design-prompt-input');
    if (textarea && !textarea.value.trim()) {
      window.selectDesignStylePreset(selectedDesignStyle);
    }
  }
};

window.closeAiDesignModal = function() {
  const modal = document.getElementById('ai-design-modal-backdrop');
  if (modal) {
    modal.classList.remove('active');
  }
};

window.updateDesignProviderStatusUI = function() {
  const statusBox = document.getElementById('design-provider-status');
  if (!statusBox) return;

  const provider = state.imageProvider || 'fal';
  const key = state.imageApiKeys[provider];
  const providerNames = {
    fal: 'Fal.ai (FLUX.1 Schnell)',
    imagen3: 'Google Imagen 3',
    openai: 'OpenAI (DALL-E 3)',
    ideogram: 'Ideogram 2.0 (Tipografi Ustası)'
  };

  const name = providerNames[provider] || provider.toUpperCase();

  if (key && key.trim()) {
    statusBox.innerHTML = `
      <div class="provider-pill-badge">
        <span class="dot"></span>
        <span>Aktif Motor: <strong>${name}</strong> (Hazır)</span>
      </div>
      <button class="sub-btn" style="padding: 3px 8px; font-size: 10px;" onclick="window.toggleApiPopover(); window.switchApiTab('image');">⚙️ Değiştir</button>
    `;
  } else {
    statusBox.innerHTML = `
      <div class="provider-pill-badge">
        <span class="dot warn"></span>
        <span>Motor: <strong>${name}</strong> (API Anahtarı Eksik)</span>
      </div>
      <button class="sub-btn primary" style="padding: 4px 10px; font-size: 10px;" onclick="window.toggleApiPopover(); window.switchApiTab('image');">🔑 Anahtarı Kaydet</button>
    `;
  }
};

window.generateAiDesign = async function() {
  const promptInput = document.getElementById('design-prompt-input');
  const prompt = promptInput ? promptInput.value.trim() : '';
  if (!prompt) {
    alert("Lütfen çizilmesini istediğiniz tasarım için bir prompt girin.");
    return;
  }

  const provider = state.imageProvider || 'fal';
  const apiKey = state.imageApiKeys[provider];

  if (!apiKey || !apiKey.trim()) {
    alert(`⚠️ Lütfen önce üst menüdeki 'AI Motorları & API Havuzu' butonundan ${provider.toUpperCase()} API anahtarınızı kaydedin.`);
    const popover = document.getElementById('api-popover');
    if (popover && !popover.classList.contains('active')) {
      window.toggleApiPopover();
    }
    window.switchApiTab('image');
    return;
  }

  const btn = document.getElementById('btn-generate-design');
  const originalText = btn ? btn.innerHTML : '<span>✨ Deseni Üret & Yerleştir</span>';
  const autoRemoveBg = document.getElementById('design-auto-bg-remove')?.checked ?? true;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳ Desen Çiziliyor (${provider.toUpperCase()})...</span>`;
    }

    const rawUrl = await callAiImageApi(prompt, provider, apiKey, false);
    let finalDataUrl = await fetchImageAsDataUrl(rawUrl);

    if (autoRemoveBg) {
      if (btn) {
        btn.innerHTML = `<span>✂️ Arka Plan Şeffaf Yapılıyor (WASM)...</span>`;
      }
      try {
        const { removeBackground } = await import('@imgly/background-removal');
        const bgBlob = await removeBackground(finalDataUrl);
        finalDataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onloadend = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(bgBlob);
        });
      } catch (bgErr) {
        console.warn("Otomatik arka plan temizleme başarısız, ham görsel kullanılacak:", bgErr);
      }
    }

    const designName = `AI_${selectedDesignStyle}_${Date.now().toString().slice(-4)}.png`;
    await saveFolder('recent_design_memory', 'Son Tasarım Hafızası', [{
      id: 'recent_design',
      name: designName,
      dataUrl: finalDataUrl
    }]);

    const imgObj = new Image();
    imgObj.onload = () => {
      state.designImage = imgObj;
      state.designName = designName;
      updateDesignDropzoneUI();
      renderCanvas();
    };
    imgObj.src = finalDataUrl;

    window.closeAiDesignModal();
    alert(`🎉 AI tasarımınız başarıyla oluşturuldu ve tişörtün üzerine yerleştirildi!`);

  } catch (err) {
    console.error("generateAiDesign hata:", err);
    alert(`Desen üretilemedi: ${err.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};


