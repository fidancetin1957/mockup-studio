// src/canvas-engine.js
import { state } from './state.js';

let canvas, ctx;
let sliderSyncCallback = null;

const HANDLE_SIZE = 12;
const ROTATE_HANDLE_OFFSET = 30;

export function registerSliderSync(cb) {
  sliderSyncCallback = cb;
}

export function initCanvas() {
  canvas = document.getElementById('previewCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  canvas.width = 1000;
  canvas.height = 1000;

  setupInteractions();
  renderCanvas();
}

// -------------------------------------------------------------
// HER RENKTE GÖRÜNEN ÇİFT KATMANLI KONTUR ÇİZGİSİ
// -------------------------------------------------------------
function drawContrastDashedLine(x1, y1, x2, y2, color, dash = [8, 6], innerWidth = 2, outerWidth = 4) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = outerWidth;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = innerWidth;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

// -------------------------------------------------------------
// 🌟 PROFESYONEL PYTHON LUMINANCE & DISPLACEMENT SHADER MOTORU 🌟
// 1. Kumaşın kıvrımlarına göre tasarımı fiziksel olarak büker (Displacement Map / Warp).
// 2. Renkleri asla bozmaz (Beyaz %100 saf beyaz kalır).
// 3. Kumaşın gerçek gölge ve ışıklarını tasarımın üzerinden geçirir.
// -------------------------------------------------------------
export function applyFabricShader(targetCtx, designImg, cx, cy, dw, dh, rotation, opacity, wrinkleStrength = 90, printType = 'dtg') {
  if (!targetCtx || !designImg) return;

  const canvasW = targetCtx.canvas.width;
  const canvasH = targetCtx.canvas.height;

  // 1. Offscreen Canvas'a tasarımı orijinal renkleriyle çiz
  const offCanvas = document.createElement('canvas');
  offCanvas.width = canvasW;
  offCanvas.height = canvasH;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  offCtx.save();
  offCtx.translate(cx, cy);
  offCtx.rotate((rotation * Math.PI) / 180);
  offCtx.drawImage(designImg, -dw / 2, -dh / 2, dw, dh);
  offCtx.restore();

  // 2. Tasarımın kapladığı alanı (ROI - Region of Interest) sınırla
  const rad = Math.abs((rotation * Math.PI) / 180);
  const bbW = Math.ceil(Math.abs(dw * Math.cos(rad)) + Math.abs(dh * Math.sin(rad))) + 24;
  const bbH = Math.ceil(Math.abs(dw * Math.sin(rad)) + Math.abs(dh * Math.cos(rad))) + 24;

  const minX = Math.max(0, Math.floor(cx - bbW / 2));
  const minY = Math.max(0, Math.floor(cy - bbH / 2));
  const maxX = Math.min(canvasW, Math.ceil(cx + bbW / 2));
  const maxY = Math.min(canvasH, Math.ceil(cy + bbH / 2));
  const roiW = maxX - minX;
  const roiH = maxY - minY;

  if (roiW <= 0 || roiH <= 0) return;

  const designImgData = offCtx.getImageData(minX, minY, roiW, roiH);
  const bgImgData = targetCtx.getImageData(minX, minY, roiW, roiH);

  const dPixels = designImgData.data;
  const bgPixels = bgImgData.data;
  const totalPixels = roiW * roiH;

  // 3. Kumaş Parlaklık Haritasını (Luminance Grid) Çıkar
  const lumaGrid = new Float32Array(totalPixels);
  let totalLuma = 0;
  let sampleCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const l = (0.299 * bgPixels[idx] + 0.587 * bgPixels[idx + 1] + 0.114 * bgPixels[idx + 2]) / 255.0;
    lumaGrid[i] = l;

    if (dPixels[idx + 3] > 20) {
      totalLuma += l;
      sampleCount++;
    }
  }

  const meanLuma = sampleCount > 0 ? (totalLuma / sampleCount) : 0.5;
  const opacMult = Math.max(0, Math.min(100, opacity)) / 100;
  const wrinkleFactor = Math.max(0, Math.min(100, wrinkleStrength)) / 100;
  // Fiziksel bükülme / dalgalanma katsayısı (Python Sobel strength eşdeğeri)
  const warpStrength = wrinkleFactor * 10.0;

  // 4. Fiziksel Bükülme (Displacement Mapping) + Işık/Gölge Render Döngüsü
  for (let y = 0; y < roiH; y++) {
    const rowOffset = y * roiW;
    
    // Dikey gradyan komşuları
    const yPrev = Math.max(0, y - 2) * roiW;
    const yNext = Math.min(roiH - 1, y + 2) * roiW;

    for (let x = 0; x < roiW; x++) {
      const idx = (rowOffset + x) * 4;

      // Yatay ve Dikey Eğim (Sobel Gradyanları - Kumaşın 3D Açısı)
      const xPrev = Math.max(0, x - 2);
      const xNext = Math.min(roiW - 1, x + 2);

      const gx = (lumaGrid[rowOffset + xNext] - lumaGrid[rowOffset + xPrev]) * 0.5;
      const gy = (lumaGrid[yNext + x] - lumaGrid[yPrev + x]) * 0.5;

      // 🌟 FİZİKSEL BÜKÜLME (DISPLACEMENT WARPING) 🌟
      // Kumaşın kıvrıldığı yöne doğru tasarım pikseli eğilir / kayar
      const srcX = Math.max(0, Math.min(roiW - 1, Math.round(x + gx * warpStrength)));
      const srcY = Math.max(0, Math.min(roiH - 1, Math.round(y + gy * warpStrength)));
      const srcIdx = (srcY * roiW + srcX) * 4;

      const a = dPixels[srcIdx + 3];
      if (a === 0) continue;

      let desR = dPixels[srcIdx];
      let desG = dPixels[srcIdx + 1];
      let desB = dPixels[srcIdx + 2];

      const bgR = bgPixels[idx];
      const bgG = bgPixels[idx + 1];
      const bgB = bgPixels[idx + 2];
      const bgLuma = lumaGrid[rowOffset + x];

      // Kumaş gölge ve ışık farkı
      const diff = bgLuma - meanLuma;

      if (wrinkleFactor > 0) {
        if (diff < 0) {
          // GÖLGE
          let shadowAmt = Math.min(1.0, -diff * 3.5) * wrinkleFactor;
          if (printType === 'dtf') shadowAmt *= 0.6; // DTF plastiktir, gölgeler çok derin olmaz
          
          desR = Math.max(0, desR * (1.0 - shadowAmt * 0.65));
          desG = Math.max(0, desG * (1.0 - shadowAmt * 0.65));
          desB = Math.max(0, desB * (1.0 - shadowAmt * 0.65));
        } else if (diff > 0) {
          // IŞIK
          let highlightAmt = Math.min(1.0, diff * 3.0) * wrinkleFactor;
          if (printType === 'dtf') highlightAmt *= 1.4; // DTF plastiktir, ışığı daha çok yansıtır
          if (printType === 'vintage') highlightAmt *= 0.5; // Vintage mattır
          
          desR = Math.min(255, desR + (255 - desR) * highlightAmt * 0.45);
          desG = Math.min(255, desG + (255 - desG) * highlightAmt * 0.45);
          desB = Math.min(255, desB + (255 - desB) * highlightAmt * 0.45);
        }
      }

      let finalAlpha = (a / 255.0) * opacMult;
      
      if (printType === 'vintage') {
         // Vintage soluktur, en fazla %85 opaklık
         finalAlpha *= 0.85;
         // Kumaş dokusu mürekkebin içine çok girer (Multiply efektine yakın)
         desR = desR * (0.5 + bgLuma * 0.5);
         desG = desG * (0.5 + bgLuma * 0.5);
         desB = desB * (0.5 + bgLuma * 0.5);
      }
      
      if (a > 0 && a < 245) {
        if (printType === 'dtg' || printType === 'vintage') {
          // DTG ve Vintage kumaşa kaynaşır
          const edgeDiffusion = 0.88 + (bgLuma * 0.12);
          finalAlpha *= edgeDiffusion;
        } else if (printType === 'dtf') {
          // DTF plastik yüzeydir, keskin kalır
          finalAlpha = finalAlpha; 
        }
      }

      // Alpha kompozit (Doğal kumaş üzerine giydirme)
      bgPixels[idx]     = Math.round(desR * finalAlpha + bgR * (1.0 - finalAlpha));
      bgPixels[idx + 1] = Math.round(desG * finalAlpha + bgG * (1.0 - finalAlpha));
      bgPixels[idx + 2] = Math.round(desB * finalAlpha + bgB * (1.0 - finalAlpha));
      bgPixels[idx + 3] = 255;
    }
  }

  // 5. Bükülmüş, Kaynaştırılmış ve Gölgelendirilmiş Sonucu Canvas'a Bas
  targetCtx.putImageData(bgImgData, minX, minY);
}

// -------------------------------------------------------------
// CANVAS DRAWING ENGINE (GERÇEK POD MOCKUP MOTORU)
// -------------------------------------------------------------
export function renderCanvas() {
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Arka Plan (Boş Mockup)
  if (state.generatedBgImage) {
    ctx.drawImage(state.generatedBgImage, 0, 0, canvas.width, canvas.height);
  } else {
    drawEmptyStateBackground();
  }

  // 2. Kırmızı Kare / İnteraktif Baskı Kılavuzu & Eksen Çizgileri
  if (state.showPrintGuide) {
    drawInteractivePrintGuide();
  }

  // 3. Tasarım (PNG) Çizimi - 🌟 KILAVUZ KUTUSUNA PROPORSIYONEL SIĞDIRMA VE TEPEDEN KİLİTLEME 🌟
  if (state.designImage) {
    const box = state.mappingBox;
    const aspect = state.designImage.width / state.designImage.height;
    
    // Tasarım sağdan, soldan, yukarıdan ve aşağıdan kılavuz kutusunun içine tam sığar (Aspect Contain)
    let dw = box.width;
    let dh = dw / aspect;

    if (dh > box.height) {
      dh = box.height;
      dw = dh * aspect;
    }

    // Kırmızı kutunun üst kenarı
    const boxTopY = (canvas.height / 2 + box.y) - (box.height / 2);
    
    // Tasarımın tepesi tam kılavuzun tavan çizgisine oturur (Top-Anchor)
    const cx = (canvas.width / 2 + box.x) + (state.posX || 0);
    const cy = boxTopY + (dh / 2) + (state.posY || 0);

    if (state.generatedBgImage) {
      applyFabricShader(ctx, state.designImage, cx, cy, dw, dh, state.rotation, state.opacity, state.wrinkleStrength !== undefined ? state.wrinkleStrength : 90, state.printType);
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((state.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, Math.min(1, state.opacity / 100));
      ctx.drawImage(state.designImage, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    // 4. Bounding Box & Tutamaçlar
    if (state.showTransformBox && !state.showPrintGuide) {
      drawBoundingBox(cx, cy, dw, dh, state.rotation);
    }
  }
}

function drawEmptyStateBackground() {
  ctx.fillStyle = '#0E111D';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Sol menüden bir Mockup Şablonu seçin veya boş fotoğraf yükleyin', canvas.width / 2, canvas.height / 2);
}

// 🌟 İNTERAKTİF KIRMIZI KARE + BOYDAN BOYA EKSEN + YAN ÖLÇEKLER 🌟
function drawInteractivePrintGuide() {
  const box = state.mappingBox;
  const cx = canvas.width / 2 + box.x;
  const cy = canvas.height / 2 + box.y;

  // 1. Boydan Boya Eksen Çizgileri
  drawContrastDashedLine(cx, 0, cx, canvas.height, '#FF2E54', [8, 6], 2, 4);
  drawContrastDashedLine(0, cy, canvas.width, cy, '#FF2E54', [8, 6], 2, 4);

  // 2. Yan Basamaklı Renkli Ölçek Çizgileri
  const sideGuides = [
    { offset: 28, height: box.height * 0.78, color: '#00E5FF' },
    { offset: 56, height: box.height * 0.58, color: '#00E676' },
    { offset: 84, height: box.height * 0.38, color: '#D500F9' }
  ];

  sideGuides.forEach(g => {
    drawContrastDashedLine(
      cx - box.width / 2 - g.offset, cy - g.height / 2,
      cx - box.width / 2 - g.offset, cy + g.height / 2,
      g.color, [6, 4], 2.2, 4.2
    );

    drawContrastDashedLine(
      cx + box.width / 2 + g.offset, cy - g.height / 2,
      cx + box.width / 2 + g.offset, cy + g.height / 2,
      g.color, [6, 4], 2.2, 4.2
    );
  });

  // 3. Kırmızı Kılavuz Kutusu
  ctx.save();
  ctx.translate(cx, cy);

  // Kırmızı Saydam Alan - TASARIMIN RENGİNİ BOZDUĞU VE KULLANICIYI YANILTTIĞI İÇİN KALDIRILDI
  // Sadece çerçeve gösterilecek, böylece mockup'ın gerçek dokusu ve rengi izlenebilecek.
  // ctx.fillStyle = 'rgba(255, 46, 84, 0.12)';
  // ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);

  // Çift Katmanlı Çerçeve
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);

  ctx.strokeStyle = '#FF2E54';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
  ctx.restore();

  // 🌟 Üst Başlangıç Çizgisi (Tasarımın Üstü Buraya Oturur) 🌟
  ctx.save();
  ctx.strokeStyle = '#00E5FF';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-box.width / 2 + 8, -box.height / 2);
  ctx.lineTo(box.width / 2 - 8, -box.height / 2);
  ctx.stroke();
  ctx.restore();

  // Merkez Artı (+)
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
  ctx.moveTo(0, -15); ctx.lineTo(0, 15);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
  ctx.moveTo(0, -15); ctx.lineTo(0, 15);
  ctx.stroke();
  ctx.restore();

  // 4 Köşe Tutamaçları
  const corners = [
    { x: -box.width / 2, y: -box.height / 2 },
    { x: box.width / 2, y: -box.height / 2 },
    { x: -box.width / 2, y: box.height / 2 },
    { x: box.width / 2, y: box.height / 2 }
  ];

  corners.forEach(c => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#FF2E54';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  ctx.restore();
}

function drawBoundingBox(cx, cy, dw, dh, rotation) {
  drawContrastDashedLine(cx, 0, cx, canvas.height, '#6366F1', [6, 6], 1.5, 3.5);
  drawContrastDashedLine(0, cy, canvas.width, cy, '#6366F1', [6, 6], 1.5, 3.5);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.strokeStyle = '#6366F1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
  ctx.moveTo(0, -10); ctx.lineTo(0, 10);
  ctx.stroke();

  const corners = [
    { x: -dw / 2, y: -dh / 2 },
    { x: dw / 2, y: -dh / 2 },
    { x: -dw / 2, y: dh / 2 },
    { x: dw / 2, y: dh / 2 }
  ];

  corners.forEach(c => {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#6366F1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(0, -dh / 2);
  ctx.lineTo(0, -dh / 2 - ROTATE_HANDLE_OFFSET);
  ctx.strokeStyle = '#6366F1';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, -dh / 2 - ROTATE_HANDLE_OFFSET, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
  ctx.fillStyle = '#10B981';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------
// İNTERAKTİF SÜRÜKLE-BIRAK, DÖNDÜRME VE KILAVUZ HAREKETİ
// -------------------------------------------------------------
function setupInteractions() {
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onMouseUp);
}

function getCanvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function onMouseDown(e) {
  const pt = getCanvasPoint(e);
  startDrag(pt.x, pt.y);
}

function onTouchStart(e) {
  e.preventDefault();
  const pt = getCanvasPoint(e);
  startDrag(pt.x, pt.y);
}

function startDrag(px, py) {
  const hitTolerance = HANDLE_SIZE + 6;

  // A) ÖNCELİK 1: Kırmızı Kılavuz (Harita) Açık İse Kılavuzu Yakala
  if (state.showPrintGuide) {
    const box = state.mappingBox;
    const gcx = canvas.width / 2 + box.x;
    const gcy = canvas.height / 2 + box.y;
    const gdx = px - gcx;
    const gdy = py - gcy;

    if (Math.hypot(gdx - (-box.width / 2), gdy - (-box.height / 2)) <= hitTolerance) {
      initGuideDrag('guide-tl', px, py); return;
    }
    if (Math.hypot(gdx - (box.width / 2), gdy - (-box.height / 2)) <= hitTolerance) {
      initGuideDrag('guide-tr', px, py); return;
    }
    if (Math.hypot(gdx - (-box.width / 2), gdy - (box.height / 2)) <= hitTolerance) {
      initGuideDrag('guide-bl', px, py); return;
    }
    if (Math.hypot(gdx - (box.width / 2), gdy - (box.height / 2)) <= hitTolerance) {
      initGuideDrag('guide-br', px, py); return;
    }

    if (Math.abs(gdx) <= box.width / 2 && Math.abs(gdy) <= box.height / 2) {
      initGuideDrag('guide-move', px, py); return;
    }
  }

  // B) ÖNCELİK 2: Tasarım (PNG) Üzerindeki Etkileşim
  if (state.designImage) {
    const box = state.mappingBox;
    const aspect = state.designImage.width / state.designImage.height;
    let dw = box.width;
    let dh = dw / aspect;

    if (dh > box.height) {
      dh = box.height;
      dw = dh * aspect;
    }

    const boxTopY = (canvas.height / 2 + box.y) - (box.height / 2);
    const cx = (canvas.width / 2 + box.x) + (state.posX || 0);
    const cy = boxTopY + (dh / 2) + (state.posY || 0);

    const rad = (-state.rotation * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

    if (Math.hypot(rx - 0, ry - (-dh / 2 - ROTATE_HANDLE_OFFSET)) <= hitTolerance) {
      state.isDragging = true;
      state.dragMode = 'rotate';
      state.dragStartX = px;
      state.dragStartY = py;
      state.initialDragState = {
        posX: state.posX,
        posY: state.posY,
        scale: state.scale,
        rotation: state.rotation,
        cx,
        cy
      };
      return;
    }

    if (Math.hypot(rx - (-dw / 2), ry - (-dh / 2)) <= hitTolerance) {
      initScaleDrag('scale-tl', px, py, cx, cy); return;
    }
    if (Math.hypot(rx - (dw / 2), ry - (-dh / 2)) <= hitTolerance) {
      initScaleDrag('scale-tr', px, py, cx, cy); return;
    }
    if (Math.hypot(rx - (-dw / 2), ry - (dh / 2)) <= hitTolerance) {
      initScaleDrag('scale-bl', px, py, cx, cy); return;
    }
    if (Math.hypot(rx - (dw / 2), ry - (dh / 2)) <= hitTolerance) {
      initScaleDrag('scale-br', px, py, cx, cy); return;
    }

    if (Math.abs(rx) <= dw / 2 && Math.abs(ry) <= dh / 2) {
      state.isDragging = true;
      state.dragMode = 'move';
      state.dragStartX = px;
      state.dragStartY = py;
      state.initialDragState = {
        posX: state.posX,
        posY: state.posY,
        scale: state.scale,
        rotation: state.rotation,
        cx,
        cy
      };
    }
  }
}

function initGuideDrag(mode, px, py) {
  state.isDragging = true;
  state.dragMode = mode;
  state.dragStartX = px;
  state.dragStartY = py;
  state.initialDragState = {
    mappingBox: { ...state.mappingBox },
    posX: state.posX,
    posY: state.posY,
    scale: state.scale
  };
}

function initScaleDrag(mode, px, py, cx, cy) {
  state.isDragging = true;
  state.dragMode = mode;
  state.dragStartX = px;
  state.dragStartY = py;
  state.initialDragState = {
    posX: state.posX,
    posY: state.posY,
    scale: state.scale,
    rotation: state.rotation,
    cx,
    cy
  };
}

function onMouseMove(e) {
  const pt = getCanvasPoint(e);

  if (state.isDragging) {
    handleDragMove(pt.x, pt.y);
    return;
  }

  updateCursor(pt.x, pt.y);
}

function onTouchMove(e) {
  if (!state.isDragging) return;
  e.preventDefault();
  const pt = getCanvasPoint(e);
  handleDragMove(pt.x, pt.y);
}

function updateCursor(px, py) {
  if (!canvas) return;

  if (state.showPrintGuide) {
    const box = state.mappingBox;
    const gcx = canvas.width / 2 + box.x;
    const gcy = canvas.height / 2 + box.y;
    const gdx = px - gcx;
    const gdy = py - gcy;
    const hit = HANDLE_SIZE + 6;

    if (Math.hypot(gdx - (-box.width/2), gdy - (-box.height/2)) <= hit ||
        Math.hypot(gdx - (box.width/2), gdy - (box.height/2)) <= hit) {
      canvas.style.cursor = 'nwse-resize'; return;
    }
    if (Math.hypot(gdx - (box.width/2), gdy - (-box.height/2)) <= hit ||
        Math.hypot(gdx - (-box.width/2), gdy - (box.height/2)) <= hit) {
      canvas.style.cursor = 'nesw-resize'; return;
    }
    if (Math.abs(gdx) <= box.width / 2 && Math.abs(gdy) <= box.height / 2) {
      canvas.style.cursor = 'move'; return;
    }
  }

  canvas.style.cursor = 'default';
}

function handleDragMove(px, py) {
  const init = state.initialDragState;
  if (!init) return;

  // A) KILAVUZ HAREKETLERİ (Kırmızı Kare Haritalama)
  if (state.dragMode === 'guide-move') {
    const deltaX = px - state.dragStartX;
    const deltaY = py - state.dragStartY;
    state.mappingBox.x = Math.round(init.mappingBox.x + deltaX);
    state.mappingBox.y = Math.round(init.mappingBox.y + deltaY);

    if (sliderSyncCallback) sliderSyncCallback();
    renderCanvas();
    return;
  }

  if (state.dragMode && state.dragMode.startsWith('guide-')) {
    const deltaX = px - state.dragStartX;
    const deltaY = py - state.dragStartY;
    let nw = init.mappingBox.width;
    let nh = init.mappingBox.height;

    if (state.dragMode === 'guide-br') {
      nw = Math.max(100, Math.min(800, init.mappingBox.width + deltaX * 2));
      nh = Math.max(100, Math.min(900, init.mappingBox.height + deltaY * 2));
    } else if (state.dragMode === 'guide-tl') {
      nw = Math.max(100, Math.min(800, init.mappingBox.width - deltaX * 2));
      nh = Math.max(100, Math.min(900, init.mappingBox.height - deltaY * 2));
    } else if (state.dragMode === 'guide-tr') {
      nw = Math.max(100, Math.min(800, init.mappingBox.width + deltaX * 2));
      nh = Math.max(100, Math.min(900, init.mappingBox.height - deltaY * 2));
    } else if (state.dragMode === 'guide-bl') {
      nw = Math.max(100, Math.min(800, init.mappingBox.width - deltaX * 2));
      nh = Math.max(100, Math.min(900, init.mappingBox.height + deltaY * 2));
    }

    state.mappingBox.width = Math.round(nw);
    state.mappingBox.height = Math.round(nh);

    if (sliderSyncCallback) sliderSyncCallback();
    renderCanvas();
    return;
  }

  // B) TASARIM HAREKETLERİ (PNG)
  if (state.dragMode === 'move') {
    const deltaX = px - state.dragStartX;
    const deltaY = py - state.dragStartY;
    state.posX = Math.round(init.posX + deltaX);
    state.posY = Math.round(init.posY + deltaY);
  } else if (state.dragMode === 'rotate') {
    const cx = init.cx;
    const cy = init.cy;
    const angleRad = Math.atan2(py - cy, px - cx);
    let deg = Math.round((angleRad * 180) / Math.PI) + 90;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    state.rotation = deg;
  } else if (state.dragMode && state.dragMode.startsWith('scale')) {
    const cx = init.cx;
    const cy = init.cy;
    const initDist = Math.hypot(state.dragStartX - cx, state.dragStartY - cy);
    const currDist = Math.hypot(px - cx, py - cy);

    if (initDist > 0) {
      const scaleFactor = currDist / initDist;
      const newScale = Math.round(init.scale * scaleFactor);
      state.scale = Math.max(5, Math.min(100, newScale));
      state.mappingBox.width = Math.round(canvas.width * (state.scale / 100));
      state.mappingBox.height = Math.round(state.mappingBox.width * 1.31);
    }
  }

  if (sliderSyncCallback) sliderSyncCallback();
  renderCanvas();
}

function onMouseUp() {
  if (state.isDragging) {
    state.isDragging = false;
    state.dragMode = null;
    state.initialDragState = null;

    // Sürükleme / yeniden boyutlandırma bittiğinde aktif mockup kaydını canlı tut
    if (state.currentFolder && state.currentFolder.images && state.currentFolder.images[state.activeBgIndex]) {
      const cur = state.currentFolder.images[state.activeBgIndex];
      if (!cur.mapData) cur.mapData = {};
      cur.mapData.posX = state.posX;
      cur.mapData.posY = state.posY;
      cur.mapData.scale = state.scale;
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
}

// -------------------------------------------------------------
// YÜKSEK ÇÖZÜNÜRLÜKLÜ 300 DPI RENDER & BATCH İNDİRME MOTORU
// -------------------------------------------------------------
export async function renderHighResBlob(bgImg, designImg, coords, format = 'png', scaleFactor = 3) {
  const targetDim = 1000 * scaleFactor;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = targetDim;
  offCanvas.height = targetDim;
  const offCtx = offCanvas.getContext('2d');

  if (bgImg) {
    offCtx.drawImage(bgImg, 0, 0, targetDim, targetDim);
  } else {
    offCtx.fillStyle = '#FFFFFF';
    offCtx.fillRect(0, 0, targetDim, targetDim);
  }

  if (designImg) {
    const box = coords.mappingBox || {
      x: coords.posX || 0,
      y: coords.posY || -80,
      width: 350,
      height: 460
    };

    const aspect = designImg.width / designImg.height;
    const targetBoxW = (box.width || 350) * scaleFactor;
    const targetBoxH = (box.height || 460) * scaleFactor;

    let dw = targetBoxW;
    let dh = dw / aspect;

    if (dh > targetBoxH) {
      dh = targetBoxH;
      dw = dh * aspect;
    }

    const boxTopY = (targetDim / 2 + (box.y * scaleFactor)) - (targetBoxH / 2);
    const cx = (targetDim / 2 + (box.x * scaleFactor)) + ((coords.posX || 0) * scaleFactor);
    const cy = boxTopY + (dh / 2) + ((coords.posY || 0) * scaleFactor);

    if (bgImg) {
      applyFabricShader(offCtx, designImg, cx, cy, dw, dh, coords.rotation, coords.opacity, coords.wrinkleStrength !== undefined ? coords.wrinkleStrength : 90, coords.printType);
    } else {
      offCtx.save();
      offCtx.translate(cx, cy);
      offCtx.rotate((coords.rotation * Math.PI) / 180);
      offCtx.globalAlpha = Math.max(0, Math.min(1, (coords.opacity || 100) / 100));
      offCtx.drawImage(designImg, -dw / 2, -dh / 2, dw, dh);
      offCtx.restore();
    }
  }

  return new Promise(resolve => {
    let mimeType = 'image/png';
    let quality = 0.95;
    if (format === 'jpeg') mimeType = 'image/jpeg';
    if (format === 'webp') mimeType = 'image/webp';

    offCanvas.toBlob(blob => resolve(blob), mimeType, quality);
  });
}

export async function downloadCurrentMockup() {
  if (!state.designImage && !state.generatedBgImage) {
    alert("Lütfen önce bir mockup veya tasarım yükleyin.");
    return;
  }

  const multiplierMap = { '2x': 2, '3x': 3, '4x': 4, '5x': 5 };
  const mult = multiplierMap[state.exportScale] || 3;

  const blob = await renderHighResBlob(
    state.generatedBgImage,
    state.designImage,
    {
      posX: state.posX,
      posY: state.posY,
      scale: state.scale,
      rotation: state.rotation,
      opacity: state.opacity,
      printType: state.printType,
      mappingBox: state.mappingBox
    },
    state.exportFormat,
    mult
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const ext = state.exportFormat === 'jpeg' ? 'jpg' : state.exportFormat;
  link.download = `Mockup_300DPI_${Date.now()}.${ext}`;
  link.click();
  URL.revokeObjectURL(url);
}
