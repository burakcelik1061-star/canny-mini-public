import { resolveTestDatabaseUrl } from './test-database-url';

// Jest setupFiles — HER test dosyasının kendi ortamında, uygulama modülleri
// yüklenmeden önce çalışır. global-setup.ts zaten aynı değeri set ediyor
// (ve migration'ları uyguluyor) ama o parent process'te çalışıyor; bu dosya
// worker process'lerinde de doğru DB'ye bağlanıldığının garantisi —
// yanlışlıkla geliştirme veritabanına TRUNCATE atmamak için tek bir
// mekanizmaya güvenmek istemedik.
process.env.DATABASE_URL = resolveTestDatabaseUrl();

// Faz 7.4 — integration testleri aynı IP'den onlarca kayıt/giriş yapıyor
// ve auth uçlarındaki dar limite (dakikada 10) takılırlardı. Rate
// limiting'in KENDİSİ ayrıca test ediliyor:
// throttling.integration-spec.ts bu bayrağı geçici olarak kapatıp gerçekten
// 429 alındığını doğruluyor — yani "testler geçsin diye kapatıldı ve bir
// daha bakılmadı" durumu oluşmuyor.
process.env.THROTTLE_DISABLED = 'true';
