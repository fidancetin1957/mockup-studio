# 🎯 Mockup Studio POD Fabrikası — Altın Standartlar & Kullanıcı İstekleri Rehberi

Bu doküman, Mockup Studio (Faz 1) sisteminin kullanıcı beklentilerini, mimari kurallarını ve teknik çalışma prensiplerini tanımlayan resmi standart belgesidir.

---

## 1. Grafik Tasarım (PNG) Yönetim Standardı

| Madde | Kullanıcı Beklentisi | Sistemin Davranışı (Olması Gereken) |
| :--- | :--- | :--- |
| **Hafıza & Kalıcılık** | Her sayfa açıldığında veya yenilendiğinde son yüklenen tasarım ekranda hazır olmalı. | `IndexedDB` üzerinde `recent_design_memory` tablosuna mühürlenir. Sayfa açılışında anında sahneye aktarılır. |
| **Görsel Önizleme** | Sol menüde sadece dosya adı değil, yüklenen PNG'nin gerçek küçük resmi (thumbnail) görünmeli. | Dropzone alanı içinde 52x52px saydam dama zeminli gerçek tasarım görseli ve "✓ Aktif Tasarım" rozeti gösterilir. |
| **Tek Tıkla Silme** | Tasarım tek tıkla sahneden kaldırılabilmeli. | `🗑 Kaldır` butonu ile tasarım sahneden silinir, hafıza sıfırlanır, mockup temiz kalır. |
| **Bağımsızlık Kuralı** | Yeni bir PNG yüklendiğinde mockup'ın kaydedilmiş göğüs konumu bozulmamalı. | PNG yükleme eylemi (`handleDesignFile`) sadece tasarım nesnesini günceller; koordinatları ezmez. |

---

## 2. Konumlandırma, Haritalama & Kılavuz Standardı

| Madde | Kullanıcı Beklentisi | Sistemin Davranışı (Olması Gereken) |
| :--- | :--- | :--- |
| **Tepeden Kilitli Hizalama** | Tasarım kutunun ortasında asılı kalmamalı; yakadan 2-3 parmak aşağıdan (**Top-Anchor**) başlamalı. | Kırmızı kılavuzun üst kenarı (`boxTopY + 10px`) referans alınır. Tasarım tavan çizgisine oturur. |
| **Sıfırlama Hamallığının Bitmesi** | Mockup değiştirildiğinde tasarım kafasına göre kaymamalı; "Sıfırla/Ortala"ya basmaya gerek kalmadan doğru açılmalı. | Eski veritabanı kayıtlarındaki çift ofset (`posY = -80`) otomatik temizlenir; her mockup temiz `posY = 0` ile açılır. |
| **Kılavuz Kontrolü** | Kırmızı kılavuz çizgileri tek tıkla gizlenebilmeli. | `Kılavuz: Açık/Gizli` butonu ile çıplak gözle gerçek mockup izlenebilir. |
| **Toplu Mühürleme** | 50'li mockup klasöründe tek ayarla tüm tişörtler haritalanabilmeli. | "Bu Konumu Tüm Klasöre Mühürle" butonu tüm görsellerin `mapData` alanını tek seferde günceller. |

---

## 3. Kumaş Uyumu & Renk Doğruluğu (Luminance Shader Standardı)

| Madde | Kullanıcı Beklentisi | Sistemin Davranışı (Olması Gereken) |
| :--- | :--- | :--- |
| **Renk Değişmezliği** | Pembe, yeşil, kırmızı tişörtlerde beyaz yazılar veya logolar asla tişörtün rengine dönmemeli. | Standart `Multiply` kaldırıldı. Python V5 `Luminance Linear Dodge/Burn` matrisi kullanılır. Beyaz %100 beyaz kalır. |
| **Kumaş Dokusu & Kıvrımlar** | Tasarım sticker gibi durmamalı; kumaşın iplik örgüsü ve katlantı gölgeleri tasarımın üzerinden geçmeli. | Tişörtün parlaklık haritası (`bgLuma`) ile yerel ortalama (`meanLuma`) arasındaki fark hesaplanır. Gölgeler koyulaştırılır, ışıklar parlatılır. |
| **Kıvrım Ayarı** | Açık/Koyu zemin karmaşası olmadan tek bir derinlik ayarı olmalı. | `🌊 Kumaş Kıvrım & Gölge Doygunluğu (%0 - %100)` slider'ı ile kullanıcı istediği gerçekçilik seviyesini ayarlar. |

---

## 4. Dışa Aktarma (Export) & Toplu İndirme Standardı

| Madde | Kullanıcı Beklentisi | Sistemin Davranışı (Olması Gereken) |
| :--- | :--- | :--- |
| **300 DPI Çıktı Kalitesi** | Ekrandaki görüntü neyse, indirilen dosya 3000x3000px ultra yüksek çözünürlükte birebir aynı olmalı. | `renderHighResBlob` fonksiyonu ekrandaki matematik formülünün `scaleFactor` ile çarpılmış 1:1 kopyasını render alır. |
| **Tek Tıkla Toplu İndirme** | 50 mockup tek tıkla ZIP olarak hızlıca indirilebilmeli. | Asenkron kuyruk yapısıyla tarayıcı kilitlenmeden yüksek kaliteli ZIP arşivi üretilir. |

---

## 5. Koordinat Matematik Formülü (Kilitli & Değiştirilemez)

```javascript
// 1. Kırmızı Kılavuz Kutusu (Baskı Alanı)
const boxTopY = (canvasHeight / 2 + box.y) - (box.height / 2);

// 2. Tasarım Boyutları (Scale ile Orantılı)
const dw = canvasWidth * (scale / 100);
const dh = dw / aspect;

// 3. Tasarım Merkez Koordinatları (Tepeden Kilitli + 10px Yaka Boşluğu)
const cx = (canvasWidth / 2 + box.x) + (posX || 0);
const cy = boxTopY + (dh / 2) + 10 + (posY || 0);
```
