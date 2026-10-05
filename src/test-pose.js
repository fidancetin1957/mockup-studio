// src/test-pose.js

const TEST_IMAGES = [
  { name: "04_Graphite.jpg", label: "04 Graphite — Yan Duruşlu Kadın", path: "/test_images/04_Graphite.jpg" },
  { name: "02_Ivory.jpg", label: "02 Ivory — Kot Pantolonlu Manken", path: "/test_images/02_Ivory.jpg" },
  { name: "Lifestyle_Gameday.jpg", label: "Lifestyle Gameday — Beyaz Tişört", path: "/test_images/Lifestyle_Gameday.jpg" },
  { name: "Faceless_White.jpg", label: "Faceless Street — Sokak Modeli", path: "/test_images/Faceless_White.jpg" },
  { name: "05_Navy.jpg", label: "05 Navy — Dış Mekan Manken", path: "/test_images/05_Navy.jpg" },
  { name: "09_Terracotta.jpg", label: "09 Terracotta — Çapraz Bacaklı Manken", path: "/test_images/09_Terracotta.jpg" }
];

const sampleDesignImg = new Image();
sampleDesignImg.crossOrigin = 'anonymous';
sampleDesignImg.src = '/test_images/Collegiate_Bold.png';

let cachedDetections = [];
let isModelReady = false;
const manualOverrides = {};

// -------------------------------------------------------------
// 3D KUMAŞ KIVRIM & BÜKÜLME MOTORU (SOBEL DISPLACEMENT SHADER)
// -------------------------------------------------------------
function applyFabricShader(targetCtx, designImg, cx, cy, dw, dh, rotation, printType, wrinkleStrength) {
  if (!targetCtx || !designImg || !designImg.complete) return;

  const canvasW = targetCtx.canvas.width;
  const canvasH = targetCtx.canvas.height;

  // 1. Offscreen Canvas
  const offCanvas = document.createElement('canvas');
  offCanvas.width = canvasW;
  offCanvas.height = canvasH;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

  offCtx.save();
  offCtx.translate(cx, cy);
  offCtx.rotate((rotation * Math.PI) / 180);
  offCtx.drawImage(designImg, -dw / 2, -dh / 2, dw, dh);
  offCtx.restore();

  // 2. ROI (Region of Interest)
  const rad = Math.abs((rotation * Math.PI) / 180);
  const bbW = Math.ceil(Math.abs(dw * Math.cos(rad)) + Math.abs(dh * Math.sin(rad))) + 30;
  const bbH = Math.ceil(Math.abs(dw * Math.sin(rad)) + Math.abs(dh * Math.cos(rad))) + 30;

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

  // 3. Kumaş Parlaklık Haritası (Luminance Grid)
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
  const wrinkleFactor = Math.max(0, Math.min(100, wrinkleStrength)) / 100;
  const warpStrength = wrinkleFactor * 12.0; // 3D Sobel bükülme kuvveti

  // 🎨 3 BASKI TEKNOLOJİSİ REÇETESİ
  let opacityMult = 0.95;
  let shadowIntensity = 0.65;
  let highlightIntensity = 0.45;

  if (printType === 'dtg') {
    opacityMult = 0.94; // Doğal pamuk içine emilen mat mürekkep
    shadowIntensity = 0.70;
    highlightIntensity = 0.35;
  } else if (printType === 'dtf') {
    opacityMult = 0.99; // Canlı pürüzsüz transfer film
    shadowIntensity = 0.50;
    highlightIntensity = 0.55; // Saten parlama
  } else if (printType === 'vintage') {
    opacityMult = 0.82; // Yıkanmış retro soluk pigment
    shadowIntensity = 0.85;
    highlightIntensity = 0.30;
  }

  // 4. 3D Displacement & Shading Döngüsü
  for (let y = 0; y < roiH; y++) {
    const rowOffset = y * roiW;
    const yPrev = Math.max(0, y - 2) * roiW;
    const yNext = Math.min(roiH - 1, y + 2) * roiW;

    for (let x = 0; x < roiW; x++) {
      const idx = (rowOffset + x) * 4;
      const xPrev = Math.max(0, x - 2);
      const xNext = Math.min(roiW - 1, x + 2);

      const gx = (lumaGrid[rowOffset + xNext] - lumaGrid[rowOffset + xPrev]) * 0.5;
      const gy = (lumaGrid[yNext + x] - lumaGrid[yPrev + x]) * 0.5;

      // 🌟 3D FİZİKSEL BÜKÜLME (DISPLACEMENT WARPING) 🌟
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

      const diff = bgLuma - meanLuma;

      if (wrinkleFactor > 0) {
        if (diff < 0) {
          // Kumaş Katlantı Gölgesi
          const shadowAmt = Math.min(1.0, -diff * 3.5) * wrinkleFactor;
          desR = Math.max(0, desR * (1.0 - shadowAmt * shadowIntensity));
          desG = Math.max(0, desG * (1.0 - shadowAmt * shadowIntensity));
          desB = Math.max(0, desB * (1.0 - shadowAmt * shadowIntensity));
        } else if (diff > 0) {
          // Kumaş Işık Parlaması
          const highlightAmt = Math.min(1.0, diff * 3.0) * wrinkleFactor;
          desR = Math.min(255, desR + (255 - desR) * highlightAmt * highlightIntensity);
          desG = Math.min(255, desG + (255 - desG) * highlightAmt * highlightIntensity);
          desB = Math.min(255, desB + (255 - desB) * highlightAmt * highlightIntensity);
        }
      }

      // Mikro Mürekkep Kaynaşması (Sub-pixel Ink Bleed)
      let finalAlpha = (a / 255.0) * opacityMult;
      if (a > 0 && a < 245) {
        const edgeDiffusion = 0.88 + (bgLuma * 0.12);
        finalAlpha *= edgeDiffusion;
      }

      // Alpha Kompozit
      bgPixels[idx]     = Math.round(desR * finalAlpha + bgR * (1.0 - finalAlpha));
      bgPixels[idx + 1] = Math.round(desG * finalAlpha + bgG * (1.0 - finalAlpha));
      bgPixels[idx + 2] = Math.round(desB * finalAlpha + bgB * (1.0 - finalAlpha));
      bgPixels[idx + 3] = 255;
    }
  }

  targetCtx.putImageData(bgImgData, minX, minY);
}

// MediaPipe Pose Scriptini Dinamik Yükle
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initPoseTest() {
  const statusBox = document.getElementById('status-box');
  const grid = document.getElementById('results-grid');

  try {
    statusBox.innerText = '⏳ Google MediaPipe Pose Kütüphanesi Yükleniyor...';
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js');
    
    statusBox.innerText = '⚙️ WebAssembly Pose Modeli Başlatılıyor...';
    const pose = new window.Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.2,
      minTrackingConfidence: 0.2
    });

    await pose.initialize();
    statusBox.innerHTML = '✅ <strong>MediaPipe + 3D Shader Motoru Hazır!</strong> Analizler Yapılıyor...';

    // Mockup görsellerini tek tek analiz et ve önbelleğe al
    cachedDetections = [];
    for (let i = 0; i < TEST_IMAGES.length; i++) {
      const item = TEST_IMAGES[i];
      await analyzeSingleMockup(pose, item, grid);
    }

    isModelReady = true;
    statusBox.innerHTML = '🎉 <strong>Mankenler Otomatik Hizalandı & 3D Kıvrımlar Giydirildi!</strong> (Yukarıdaki kontrollerle kıvrımı ve kılavuzları değiştirebilirsin)';

    setupToolbarListeners();

  } catch (err) {
    console.error("MediaPipe Test Hatası:", err);
    statusBox.innerHTML = `❌ <strong>Hata Oluştu:</strong> ${err.message}`;
    statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
    statusBox.style.color = '#EF4444';
  }
}

async function analyzeSingleMockup(pose, item, grid) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.path;

    img.onload = async () => {
      const card = document.createElement('div');
      card.className = 'card';

      const wrap = document.createElement('div');
      wrap.className = 'canvas-wrap';

      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth || 1000;
      cvs.height = img.naturalHeight || 1000;
      const ctx = cvs.getContext('2d', { willReadFrequently: true });
      wrap.appendChild(cvs);

      ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

      const body = document.createElement('div');
      body.className = 'card-body';
      body.innerHTML = `
        <div class="card-title">${item.label}</div>
        <div class="meta-line" id="meta-status-${item.name}">⏳ Analiz Ediliyor...</div>
      `;

      card.appendChild(wrap);
      card.appendChild(body);
      grid.appendChild(card);
      
      // Manuel Override Event Listener
      const btnOverride = document.getElementById(`btn-override-${item.name}`);
      if (btnOverride) {
        btnOverride.addEventListener('click', () => {
          cvs.style.cursor = 'crosshair';
          btnOverride.innerHTML = '🎯 Tıklayın...';
          btnOverride.style.background = '#FF0077';
          btnOverride.style.color = '#fff';
          
          const clickHandler = (e) => {
            const rect = cvs.getBoundingClientRect();
            const scaleX = cvs.width / rect.width;
            const scaleY = cvs.height / rect.height;
            const clickX = (e.clientX - rect.left) * scaleX;
            const clickY = (e.clientY - rect.top) * scaleY;
            
            manualOverrides[item.name] = { x: clickX, y: clickY };
            
            // Re-render
            const det = cachedDetections.find(d => d.item.name === item.name);
            if (det) {
              det.collarPx = manualOverrides[item.name];
              renderDetection(det);
            }
            
            // Reset state
            cvs.style.cursor = 'default';
            btnOverride.innerHTML = '✅ Kaydedildi';
            btnOverride.style.background = '#10B981';
            setTimeout(() => {
               btnOverride.innerHTML = '🎯 Yakayı İşaretle';
               btnOverride.style.background = '';
               btnOverride.style.color = '';
            }, 2000);
            
            cvs.removeEventListener('mousedown', clickHandler);
          };
          cvs.addEventListener('mousedown', clickHandler);
        });
      }

      const startTime = performance.now();

      pose.onResults((results) => {
        const latency = Math.round(performance.now() - startTime);

        if (results.poseLandmarks && results.poseLandmarks.length >= 25) {
          const lm = results.poseLandmarks;
          
          const lsPx = { x: lm[11].x * cvs.width, y: lm[11].y * cvs.height };
          const rsPx = { x: lm[12].x * cvs.width, y: lm[12].y * cvs.height };
          const lhPx = { x: lm[23].x * cvs.width, y: lm[23].y * cvs.height };
          const rhPx = { x: lm[24].x * cvs.width, y: lm[24].y * cvs.height };

          const shoulderDist = Math.hypot(lsPx.x - rsPx.x, lsPx.y - rsPx.y);
          
          let collarX = (lsPx.x + rsPx.x) / 2;
          let collarY = (lsPx.y + rsPx.y) / 2;
          
          const hipX = (lhPx.x + rhPx.x) / 2;
          const hipY = (lhPx.y + rhPx.y) / 2;
          
          // 🌟 OMURGA EKSENİ (Spine Vector) 🌟
          const spineDx = hipX - collarX;
          const spineDy = hipY - collarY;
          const spineRad = Math.atan2(spineDy, spineDx); // Göğüs kafesi aşağı yönü
          
          // 90 derece (Math.PI/2) = Tam Düz. Sapma = SpineRad - Math.PI/2
          const tiltDeg = (spineRad - Math.PI/2) * (180 / Math.PI);

          const collarPx = {
            x: collarX,
            y: collarY
          };

          const detection = {
            item,
            img,
            cvs,
            ctx,
            latency,
            tiltDeg,
            spineRad, // Yeni: Doğrudan yaka aşağısına inmek için
            shoulderDist,
            collarPx,
            lsPx,
            rsPx
          };

          cachedDetections.push(detection);
          renderDetection(detection);

        } else {
          const statusEl = document.getElementById(`meta-status-${item.name}`);
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:#EF4444;">⚠️ İskelet tespit edilemedi.</span>`;
          }
        }

        resolve();
      });

      await pose.send({ image: img });
    };

    img.onerror = () => resolve();
  });
}

// -------------------------------------------------------------
// RENDER FONKSİYONU (KILAVUZLAR + 3D KIVRIM)
// -------------------------------------------------------------
function renderDetection(d) {
  const showGuides = document.getElementById('toggle-guides')?.checked ?? true;
  const wrinkleStrength = parseInt(document.getElementById('wrinkle-slider')?.value || '65', 10);
  const scalePercent = parseInt(document.getElementById('scale-slider')?.value || '70', 10);
  const printType = document.getElementById('preset-select')?.value || 'dtg';

  const { cvs, ctx, img, tiltDeg, spineRad, lsPx, rsPx, shoulderDist } = d;
  
  // Manuel Override Kontrolü
  const activeCollar = manualOverrides[d.item.name] || d.collarPx;

  // 🌟 İLK BEĞENİLEN ALTIN ORAN KALİBRASYONU (%70 Standart Omuz Oranı) 🌟
  const scaleFactor = scalePercent / 100.0;
  const boxW = Math.round(shoulderDist * scaleFactor);
  const boxH = Math.round(boxW * 1.30); // 12x16 POD Oranı

  // Tasarım Boyutları (Aspect Contain)
  const aspect = sampleDesignImg.complete ? (sampleDesignImg.width / sampleDesignImg.height) : 1.0;
  let dw = boxW;
  let dh = dw / aspect;
  if (dh > boxH) {
    dh = boxH;
    dw = dh * aspect;
  }

  // Gövde Eksen Vektörü Boyunca Yakanın 2 Parmak Altı (Kompakt Göğüs Hizası)
  const topMargin = shoulderDist * 0.14; // Yakaya yakın altın mesafe
  const distDown = topMargin + (dh / 2);
  
  // spineRad yönünde aşağı iniyoruz!
  const ux = Math.cos(spineRad);
  const uy = Math.sin(spineRad);

  const designCx = activeCollar.x + ux * distDown;
  const designCy = activeCollar.y + uy * distDown;

  // 1. Arka planı temizle ve çiz
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

  // 2. 🌟 3D KUMAŞ KIVRIMI & BÜKÜLME SHADER'INI UYGULA 🌟
  if (sampleDesignImg.complete) {
    applyFabricShader(ctx, sampleDesignImg, designCx, designCy, dw, dh, tiltDeg, printType, wrinkleStrength);
  }

  // 3. Kılavuz Çizgileri (Açıksa)
  if (showGuides) {
    ctx.save();
    
    // Omuz Eksen Çizgisi (Pembe)
    ctx.strokeStyle = '#FF0077';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rsPx.x, rsPx.y);
    ctx.lineTo(lsPx.x, lsPx.y);
    ctx.stroke();

    // Omuz Eklemleri (Sarı Noktalar)
    ctx.fillStyle = '#FFEE00';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    [lsPx, rsPx].forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Yaka Çukuru (Neon Çember) - Active Collar (Manuel hedeflenmiş olabilir)
    ctx.fillStyle = '#00FFCC';
    ctx.beginPath();
    ctx.arc(activeCollar.x, activeCollar.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // Omurga Ekseni Kılavuzu (Sarı Çizgi)
    ctx.strokeStyle = 'rgba(255, 238, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(activeCollar.x, activeCollar.y);
    // Aşağı doğru 300px omurga ekseni çizelim
    ctx.lineTo(activeCollar.x + Math.cos(spineRad)*300, activeCollar.y + Math.sin(spineRad)*300);
    ctx.stroke();
    ctx.setLineDash([]);

    // Döndürülmüş Kutu (Tepeden Kilitli)
    const boxCenterDist = topMargin + (boxH / 2);
    const boxCenterX = activeCollar.x + ux * boxCenterDist;
    const boxCenterY = activeCollar.y + uy * boxCenterDist;
    
    const rad = (tiltDeg * Math.PI) / 180;

    ctx.translate(boxCenterX, boxCenterY);
    ctx.rotate(rad);

    ctx.strokeStyle = '#00FFCC';
    ctx.lineWidth = 4;
    ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

    // Kutu Üst Çizgisi (Vurgu)
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-boxW / 2, -boxH / 2);
    ctx.lineTo(boxW / 2, -boxH / 2);
    ctx.stroke();

    ctx.restore();
  }

  // Bilgi Kartını Canlı Güncelle
  const statusEl = document.getElementById(`meta-status-${d.item.name}`);
  if (statusEl) {
    statusEl.innerHTML = `
      <div style="color:var(--accent-green);font-weight:600;margin-bottom:4px;">✓ Omuz & Kıvrımlar Kilitlendi</div>
      <div><strong>Omuz:</strong> ${Math.round(shoulderDist)} px ➜ <strong>Tasarım:</strong> ${Math.round(dw)} x ${Math.round(dh)} px</div>
      <div><strong>Duruş Açısı:</strong> ${tiltDeg.toFixed(1)}° (${Math.abs(tiltDeg) > 1.5 ? 'Eğimli' : 'Düz'}) | <strong>Kıvrım:</strong> %${wrinkleStrength}</div>
    `;
  }
}

function setupToolbarListeners() {
  const toggleGuides = document.getElementById('toggle-guides');
  const scaleSlider = document.getElementById('scale-slider');
  const scaleVal = document.getElementById('scale-val');
  const wrinkleSlider = document.getElementById('wrinkle-slider');
  const wrinkleVal = document.getElementById('wrinkle-val');
  const presetSelect = document.getElementById('preset-select');

  if (toggleGuides) {
    toggleGuides.onchange = () => {
      cachedDetections.forEach(renderDetection);
    };
  }

  if (scaleSlider) {
    scaleSlider.oninput = (e) => {
      if (scaleVal) scaleVal.innerText = `${e.target.value}%`;
      cachedDetections.forEach(renderDetection);
    };
  }

  if (wrinkleSlider) {
    wrinkleSlider.oninput = (e) => {
      if (wrinkleVal) wrinkleVal.innerText = `${e.target.value}%`;
      cachedDetections.forEach(renderDetection);
    };
  }

  if (presetSelect) {
    presetSelect.onchange = () => {
      cachedDetections.forEach(renderDetection);
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPoseTest);
} else {
  initPoseTest();
}
