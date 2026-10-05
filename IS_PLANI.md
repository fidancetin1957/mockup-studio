# 🚀 Mockup Studio & ETSY_FABRIKASI Entegrasyon ve Geliştirme İş Planı

Bu belge, **Mockup Studio**'nun hem bağımsız bir kalibrasyon/reçete istasyonu olarak çalışması hem de **ETSY_FABRIKASI** otonom üretim hattına tam entegre bir "Headless Mockup Motoru" olarak bağlanması için hazırlanan resmi iş planıdır.

---

## 📌 Genel Vizyon ve Mimari Hedef

Mockup Studio iki temel rolde çalışacak şekilde kurgulanmıştır:
1. **Görsel Kalibrasyon İstasyonu (UI):** Kullanıcının yeni manken serilerini (Gildan 5000, 64000, Bella Canvas vb.) sisteme yükleyip yaka, omuz, kıvrım (%90) ve baskı türünü (DTG/DTF/Vintage) tek seferlik kalibre ettiği ve çıktı olarak bir **Reçete (JSON)** aldığı arayüz.
2. **Otonom Headless Üretim Motoru (Python Backend):** ETSY_FABRIKASI botunun arayüzü hiç açmadan, oluşturulan trend PNG tasarımını alıp ilgili klasördeki JSON reçetesini okuyarak 300 DPI 4K mockupları saniyeler içinde otomatik üretip Etsy listelemesine eklediği arka plan motoru.

---

## 🗺️ Fazlar ve Yol Haritası

### 🟢 FAZ 1: Veritabanı Yedekleme & Reçete (JSON) İçe/Dışa Aktarma
* **Hedef:** Kullanıcının yaptığı tüm manken ayarlarının metin belgesi / JSON olarak dışa aktarılması ve geri yüklenebilmesi.
* **Maddeler:**
  1. **"Reçeteyi Dışa Aktar (.json)" Butonu:** Aktif klasördeki tüm fotoğrafların dosya adı, X/Y ofsetleri, ölçek, açı, opaklık, kumaş kıvrım gücü (%90), baskı teknolojisi (dtg, dtf, vintage) ve mappingBox (yaka/omurga sınırları) verilerini mockup_config.json olarak indirir.
  2. **"Reçeteyi İçe Aktar (.json)" Butonu:** Önceden kalibre edilmiş bir JSON dosyasını yükleyerek tüm fotoğrafların koordinatlarını anında geri yükler.
  3. **Güvenlik & Sıfır Veri Kaybı:** Tarayıcı çerezleri silinse bile bilgisayardaki .json dosyası sayesinde tüm emekler saniyeler içinde geri gelir.

---

### 🟢 FAZ 2: ETSY_FABRIKASI Python Headless Entegrasyonu
* **Hedef:** MockupStudio'daki kumaş fiziği motorunu (canvas-engine.js) Python'da OpenCV/NumPy ile inşa ederek botun sıfır müdahaleyle mockup üretmesini sağlamak.
* **Maddeler:**
  1. **Python Kumaş Shader Motoru (mockup_engine.py):**
     - Tişört parlaklık haritası (Luma Matrix) hesaplama.
     - Kumaş katlantı gölgesi ve ışık tepe yansımaları (Linear Dodge/Burn).
     - Sub-pixel mürekkep difüzyonu ve DTF/Vintage modları.
  2. **JSON Reçete Okuyucu:**
     - Bot, ilgili ürün için belirlenen mockup klasörüne gider.
     - mockup_config.json dosyasını okur.
     - Yeni üretilen PNG grafiğini her mankenin yaka/göğüs koordinatlarına tam oturtarak 3000x3000px 300 DPI çıktı alır.
  3. **Tam Otonom Çıktı:** Bot hiçbir tarayıcı açmadan 10 adet mockup'ı 2-3 saniye içinde diske kaydeder ve Etsy yükleme sırasına iletir.

---

### 🟡 FAZ 3: SEO ve Akıllı Dosya İsimlendirme
* **Hedef:** Mockup çıktılarının Etsy SEO'suna ve dosya arşivleme düzenine uygun otomatik adlandırılması.
* **Maddeler:**
  1. Çıktı dosya adlarının [Tasarim_Adi]_[Renk/Manken_Adi]_300DPI.png formatında dinamik oluşturulması (Örn: Baseball_Dad_01_Chalky_Mint_300DPI.png).
  2. ZIP arşivi içinde de aynı düzenli hiyerarşinin korunması.

---

### 🟡 FAZ 4: Bellek (RAM) ve Performans Yönetimi
* **Hedef:** 50+ görsel içeren büyük klasörlerde tarayıcının veya sistemin çökmesini engellemek.
* **Maddeler:**
  1. Yüksek çözünürlüklü batch render sırasında bellek temizliği (URL.revokeObjectURL, canvas context recycling).
  2. Gerekirse toplu üretimleri 15'erli veya 20'şerli paketler halinde kuyruğa alarak belleği rahatlatma.

---

### 🔵 FAZ 5: Güvenlik, Denetimli Grup Erişimi & Ticari SaaS
* **Hedef:** Sistemi üçüncü şahıslara / kapalı çalışma grubuna güvenli bir şekilde kullandırmak, kod ve sistem hırsızlığını engellemek.
* **Maddeler:**
  1. **Tekil Oturum & Cihaz Kilidi (Anti-Account Sharing):**
     - Bir kullanıcı adı/şifre ile aynı anda sadece 1 aktif cihaz/oturum çalışabilmesi.
     - İkinci bir giriş olduğunda ilk kullanıcının otomatik çıkışa zorlanması.
  2. **Kod Koruması & Gizleme (Obfuscation + Domain Lock):**
     - canvas-engine.js ve ana algoritmaların ağır şifreleme ile okunamaz hale getirilmesi.
     - Kodun sadece belirlenen alan adında çalışacak şekilde kilitlenmesi.
  3. **Lisans / Heartbeat Doğrulaması:**
     - Yüksek çözünürlüklü indirme ve render fonksiyonlarının sunucu üzerinden token onaylı çalışması.
