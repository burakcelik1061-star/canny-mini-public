import { expect, test, type Locator, type Page } from '@playwright/test';

// Faz 7.2 — prompt-library'nin istediği ana akış, baştan sona GERÇEK bir
// tarayıcıda: kayıt ol → (workspace oluştur) → board oluştur → post ekle →
// oy ver → admin status değiştirsin.
//
// 7.1'in integration testlerinden farkı: orada HTTP katmanı gerçek ama
// tarayıcı yoktu (React hiç çalışmıyordu). Buradaki testin kanıtladığı şey
// bunun üstü — localStorage'daki oturumun sayfalar arasında taşınması,
// iyimser UI güncellemeleri, admin panelinden yapılan bir değişikliğin
// PUBLIC sayfada görünmesi, ve iki ayrı origin'in (web :3001 → api :3334)
// CORS üzerinden gerçekten konuşabilmesi.
//
// Tek bir test olarak yazıldı, adımlara bölünmedi: bunlar birbirinden
// bağımsız senaryolar değil, TEK bir kullanıcı yolculuğunun halkaları —
// ayrı test'lere bölmek her birinin öncekinin durumunu yeniden kurmasını
// (ya da testler arası gizli sıra bağımlılığı) gerektirirdi. `test.step`
// ile raporda yine ayrı ayrı görünüyorlar.

// Her koşu kendi org/board adını üretiyor. İki sebep:
//   1. Org slug'ı GLOBAL unique — sabit bir ad kullansaydık ikinci koşuda
//      backend "acme-2" üretir ve URL tahminimiz tutmazdı.
//   2. Böylece E2E veritabanını koşu başına silmeye (yıkıcı bir
//      `migrate reset`'e) hiç gerek kalmıyor; eski koşuların verisi
//      yenisini etkilemiyor (bkz. playwright.config.ts → webServer komutu).
// Adlar slug'a birebir çevrilecek şekilde seçildi (slugify: küçük harf,
// alfanümerik dışı → tire) ki board'un public URL'i tahmin edilebilsin.
const RUN_ID = Date.now().toString(36);
const ORG_NAME = `acme-${RUN_ID}`;
const BOARD_NAME = `feedback-${RUN_ID}`;
const POST_TITLE = 'Karanlık tema desteği';
const POST_DESCRIPTION = 'Gece çalışanlar için koyu bir tema olsun.';

test('ana akış: kayıt → workspace → board → post → oy → admin status değişikliği', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';

  await test.step('kayıt ol', async () => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click();

    await page.getByPlaceholder('İsim').fill('E2E Kullanıcı');
    await page.getByPlaceholder('email@example.com').fill(email);
    await page.getByPlaceholder('Şifre (en az 8 karakter)').fill(password);
    await page.getByRole('button', { name: 'Kayıt ol' }).click();

    // Kayıt başarılıysa admin shell açılır (bkz. AuthForms → saveAuth).
    await expect(page.getByText('Giriş yapan')).toBeVisible();
    await expect(page.getByText('E2E Kullanıcı')).toBeVisible();
  });

  await test.step('workspace oluştur', async () => {
    // Yeni kullanıcının hiç workspace'i yok — bu formun kendisi 7.2'de
    // eklendi (o güne kadar tarayıcıdan workspace açmak MÜMKÜN DEĞİLDİ).
    await expect(page.getByText("Henüz bir workspace'in yok.")).toBeVisible();

    await page.getByPlaceholder('Workspace adı').fill(ORG_NAME);
    await page.getByRole('button', { name: 'Workspace oluştur' }).click();

    // Slug'ı backend üretiyor; yönlendirme yanıt geldikten sonra yapılıyor.
    await page.waitForURL(`**/admin/${ORG_NAME}`);
    await expect(
      page.getByRole('heading', { name: ORG_NAME, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Rolün: Owner')).toBeVisible();
  });

  await test.step('board oluştur', async () => {
    await page.getByPlaceholder('Yeni board adı').fill(BOARD_NAME);
    await page.getByRole('button', { name: 'Board oluştur' }).click();

    const boardList = page.getByRole('listitem').filter({ hasText: BOARD_NAME });
    await expect(boardList.first()).toBeVisible();
  });

  await test.step('public board sayfasında post ekle', async () => {
    // Board'un public URL'i /<orgSlug>/<boardSlug> — slug'ı backend
    // slugify ile üretti, adları o yüzden slug-güvenli seçtik.
    await page.goto(`/${ORG_NAME}/${BOARD_NAME}`);
    await expect(
      page.getByRole('heading', { name: BOARD_NAME, level: 1 }),
    ).toBeVisible();

    // Oturum localStorage'da — admin panelinde giriş yapmıştık, public
    // sayfa da AYNI origin olduğu için giriş formunu değil "öneri ekle"
    // formunu göstermeli.
    await expect(
      page.getByText('E2E Kullanıcı olarak giriş yapıldı'),
    ).toBeVisible();

    await page.getByPlaceholder('Öneri başlığı').fill(POST_TITLE);
    await page.getByPlaceholder('Detaylar').fill(POST_DESCRIPTION);
    await page.getByRole('button', { name: 'Öneri ekle' }).click();

    await expect(
      page.getByRole('heading', { name: POST_TITLE, level: 2 }),
    ).toBeVisible();
  });

  await test.step('oy ver', async () => {
    const vote = voteButtonFor(page, POST_TITLE);

    await expect(vote).toHaveAttribute('aria-pressed', 'false');
    await expect(vote).toContainText('0');

    await vote.click();

    await expect(vote).toHaveAttribute('aria-pressed', 'true');
    await expect(vote).toContainText('1');

    // Oyun gerçekten sunucuya yazıldığının kanıtı: sayfa yenilenince
    // (SSR + yeniden fetch) hâlâ verilmiş görünmeli. İyimser UI
    // güncellemesi (board-page.tsx) tek başına bunu kanıtlamazdı.
    await page.reload();
    await expect(voteButtonFor(page, POST_TITLE)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(voteButtonFor(page, POST_TITLE)).toContainText('1');
  });

  await test.step('admin roadmap’te status’ü sürükle-bırakla değiştir', async () => {
    await page.goto(`/admin/${ORG_NAME}/roadmap`);

    const card = page.locator('article').filter({ hasText: POST_TITLE });
    await expect(card).toBeVisible();

    // Org'un tek board'u var — roadmap seçici göstermeden ilkini açıyor.
    const underReview = kanbanColumn(page, 'İnceleniyor');
    const planned = kanbanColumn(page, 'Planlandı');
    await expect(underReview.locator('article')).toHaveCount(1);
    await expect(planned.locator('article')).toHaveCount(0);

    await dragCardToColumn(page, card, planned);

    await expect(planned.locator('article')).toHaveCount(1);
    await expect(underReview.locator('article')).toHaveCount(0);
  });

  await test.step('değişiklik public post detay sayfasında görünür', async () => {
    // Kanban iyimser güncelleme yapıyor (istek arka planda gidiyor) —
    // asıl kanıt, PUBLIC sayfanın sunucudan "Planlandı" ile dönmesi.
    await page.goto(`/${ORG_NAME}/${BOARD_NAME}`);
    const postRow = page.getByRole('listitem').filter({ hasText: POST_TITLE });
    await expect(postRow).toContainText('Planlandı');

    await page.getByRole('heading', { name: POST_TITLE, level: 2 }).click();
    await expect(
      page.getByRole('heading', { name: POST_TITLE, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Planlandı')).toBeVisible();
  });
});

// Oy butonunun erişilebilir adı sadece sayıdır (▲ aria-hidden) — bu yüzden
// başlıktan post satırına inip oradaki tek aria-pressed'lı butonu alıyoruz.
function voteButtonFor(page: Page, title: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ hasText: title })
    .locator('button[aria-pressed]');
}

function kanbanColumn(page: Page, label: string): Locator {
  return page.locator('div').filter({
    has: page.getByRole('heading', { name: label, level: 3 }),
  }).last();
}

// kanban-board.tsx native HTML5 drag&drop kullanıyor (draggable +
// dragstart/drop, veri `dataTransfer`'da) — Playwright'ın mouse tabanlı
// dragTo'su bunu Chromium'da güvenilir tetiklemiyor, çünkü gerçek bir
// HTML5 sürükleme oturumu başlatmıyor. Bu yüzden event'leri PAYLAŞILAN bir
// DataTransfer nesnesiyle elle dispatch ediyoruz: uygulamanın kendi
// handler'ları (React'in sentetik event sistemi dahil) gerçekten çalışıyor,
// taklit edilen tek şey tarayıcının sürükleme jesti.
async function dragCardToColumn(
  page: Page,
  card: Locator,
  column: Locator,
): Promise<void> {
  await card.evaluate((source, target) => {
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, dataTransfer }),
    );
    target.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
    );
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    );
    source.dispatchEvent(
      new DragEvent('dragend', { bubbles: true, dataTransfer }),
    );
  }, await column.elementHandle());
}
