# O‘zbekcha Telegram yangiliklar boti

Bot RSS manbalaridan sun’iy intellekt va raqamli texnologiyalar yangiliklarini yig‘adi, mavzu bo‘yicha saralaydi va foydalanuvchilarning kanallariga joylaydi. Standart dayjestda o‘zbekcha sarlavhalar maqola havolasi sifatida chiqadi.

## Arxitektura

`bot.ts` grammY middleware, saqlanadigan suhbatlar va global xato tutuvchini sozlaydi. `handlers/` kanal ulash va sozlash amallarini bajaradi. `services/` RSS, LLM, Telegram va rejalashtirishni ajratadi. `db/repository.ts` biznes mantiqi foydalanadigan interfeysni belgilaydi; `sqlite-repository.ts` uning SQLite implementatsiyasidir. PostgreSQL’ga o‘tishda shu interfeysning yangi implementatsiyasi va migratsiyalar yoziladi, handler va xizmatlar saqlanadi.

Foydalanuvchi kanallari `owner_id` bilan ajratilgan. Barcha foydalanuvchi boshqaruv so‘rovlari kanal ID raqami bilan birga egasining ID raqamini ham talab qiladi. Bir Telegram kanali bir hisobga biriktiriladi. Ushbu versiyada kanalni faqat uning **egasi** ulaydi; oddiy administrator kanalni o‘z hisobiga biriktira olmaydi. Kanal egasi almashsa, eski hisobga avtomatik egalik berilmaydi va nashr navbatdagi ruxsat tekshiruvida to‘xtaydi.

## Fayllar

```text
src/
  main.ts                       # Ishga tushirish va to‘xtatish
  bot.ts                        # Middleware va global xato tutuvchi
  config.ts                     # dotenv va zod konfiguratsiyasi
  handlers/
    types.ts
    input.ts
    start.ts                    # Buyruqlar va kanal tugmalari
    connect.ts                  # Kanal ulash suhbati
    settings.ts                 # Kanal sozlash suhbati
  services/
    sources.ts                  # NewsSource va RSS implementatsiyasi
    topics.ts                   # Mavzular va kalit so‘zlar
    llm.ts                      # ContentWriter va LLM implementatsiyasi
    news.ts                     # Yangilik yig‘ish va matn tayyorlash
    telegram.ts                 # Ruxsat tekshiruvi va Telegram yuboruvchisi
    publisher.ts                # Band qilish va nashr
    scheduler.ts                # Takroriy tekshiruv
    publish-schedule.ts         # Kunduzgi nashr vaqtlari
    title-translator.ts         # MyMemory orqali sarlavha tarjimasi
  db/
    repository.ts               # Almashtiriladigan saqlash interfeysi
    sqlite-repository.ts
    database.ts                 # SQLite ochish va migratsiyalar
    migrate.ts                  # Alohida migratsiya buyrug‘i
    migrations/001_initial.sql
    migrations/002_channel_cooldown.sql
    migrations/003_publication_digest.sql
    migrations/004_daytime_schedule.sql
  utils/
    logger.ts
    text.ts                     # HTML, URL va kun chegarasi
  i18n/uz.ts                    # Foydalanuvchi xabarlari
test/
  helpers.ts
  repository.test.ts
  publisher.test.ts
  content.test.ts
  bot.test.ts
.env.example
Dockerfile
compose.yaml
package.json
package-lock.json
tsconfig.json
tsconfig.test.json
```

## Talablar

- Node.js 24 tavsiya etiladi; eng kam versiya 22.12.
- npm.
- BotFather’dan olingan Telegram bot tokeni.
- Telegram, RSS manbalari va tanlangan tarjima xizmatiga internet ulanishi.

Redis, navbat xizmati, ochiq port va webhook talab qilinmaydi. Bot uzoq so‘rovlar — long polling — rejimida ishlaydi. Bitta token va SQLite bazasi uchun **faqat bitta jarayon yoki konteyner** ishlating.

## Windows’da o‘rnatish

PowerShell’da:

```powershell
cd C:\Users\User\Desktop\node_js\TelegramBot\send_news
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Mavjud `.env` ni ustidan yozmang. Undagi tokenni saqlab, `.env.example` dagi yetishmayotgan parametrlarni kiriting. Quyidagi qiymatlar majburiy:

- `BOT_TOKEN`: BotFather bergan token.
- `RSS_FEEDS`: vergul bilan ajratilgan RSS/Atom havolalari.

Xulosali rejimni ishlatish uchun `NEWS_LANGUAGE=uz` va `LLM_ENABLED=true` qo‘ying. Tanlagan provayderingizning `LLM_BASE_URL`, `LLM_API_KEY` va `LLM_MODEL` qiymatlarini kiriting. JSON rejimini qo‘llamaydigan provayderda `LLM_JSON_MODE=false` qo‘ying.

```powershell
npm.cmd run migrate
npm.cmd run check
npm.cmd run build
npm.cmd start
```

Ishlab chiqish paytida fayllarni kuzatib qayta ishga tushirish:

```powershell
npm.cmd run dev
```

Linux/macOS’da shu buyruqlardagi `npm.cmd` o‘rniga `npm` ishlating. Yangi `.env` yaratish uchun `cp .env.example .env` buyrug‘idan foydalaning, agar fayl avvaldan mavjud bo‘lmasa.

`NEWS_LANGUAGE=uz-title` va `LLM_ENABLED=false` bilan bot inglizcha RSS sarlavhalarini MyMemory orqali API kalitisiz o‘zbekchaga tarjima qiladi. Kunlik bepul kvota 5 000 belgi. Tarjimaga faqat sarlavha yuboriladi va natija SQLite’da qayta foydalanish uchun saqlanadi. Tarjima muvaffaqiyatsiz bo‘lsa, o‘sha yangilik shu postdan o‘tkazib yuboriladi. [MyMemory kvotasi](https://mymemory.translated.net/doc/usagelimits.php)

Bitta dayjestda uchtagacha bosiladigan yangilik sarlavhasi chiqadi va butun dayjest kunlik limitda bitta post hisoblanadi. Post oxirida kanalning `@username`i yoki username belgilanmagan bo‘lsa kanal nomi chiqadi. `NEWS_LANGUAGE=en` asl RSS sarlavhalarini chiqaradi. `NEWS_LANGUAGE=uz` rejimida sarlavha va xulosa uchun LLM kaliti va model kerak. Muhit sozlamalari o‘zgargach botni qayta ishga tushiring.

## Foydalanuvchi kanalni qanday ulaydi?

1. Telegram’da botga shaxsiy xabar orqali `/start` yuboring.
2. O‘zingiz egalik qiladigan kanal sozlamalarida botni administrator qilib qo‘shing.
3. Botga xabar yuborish huquqini bering.
4. Botga `/connect` yuboring.
5. Ochiq kanal uchun `@kanal_nomi`, yopiq kanal uchun `-100` bilan boshlanuvchi ID raqami yoki kanaldan asl uzatilgan xabarni yuboring. Himoyalangan kanalda xabar uzatish taqiqlangan bo‘lsa, kanal ID raqamidan foydalaning. Taklif havolasi kanal ID raqami o‘rnini bosmaydi.
6. Bot kanal turini, o‘zining administrator va nashr huquqlarini hamda siz kanal egasi ekaningizni Telegram orqali tekshiradi.
7. `/channels` buyrug‘ida kerakli kanal yonidagi **Boshlash** tugmasini bosing.
8. **To‘xtatish** keyingi nashrlarni to‘xtatadi. Telegram’ga yuborilishi boshlangan so‘rovni orqaga qaytarib bo‘lmaydi.

Kanal ulanayotganda nashr o‘chiq turadi. Botni qayta administrator qilgandan keyin `/connect` bilan kanalni qayta tasdiqlang, so‘ng nashrni qo‘lda yoqing. Qayta ulash oldingi sozlamalar va nashr tarixini saqlaydi.

### Sozlamalar

`/channels` → **Sozlamalar** tugmasini bosing yoki `/settings` orqali kanal ID raqamini kiriting. Bot ketma-ket quyidagilarni so‘raydi:

1. Kunlik postlar soni **1–5**.
2. Mavzular uchun vergul bilan ajratilgan `ai`, `technology`, `cybersecurity`, `software`, `gadgets` kodlari.

Bot nashrlarni 09:00 dan 21:00 gacha taqsimlaydi. Masalan, 3 ta post tanlansa, uchta vaqt oralig‘i 09:00, 13:00 va 17:00 da boshlanadi. Bot har bir oraliqda bitta nashrga urinadi. Mos yangilik bo‘lmasa, o‘sha nashr o‘tkazib yuboriladi. Vaqtlar `/channels` buyrug‘i orqali ko‘rinadi.

Masalan, `ai,software` — sun’iy intellekt va dasturiy ta’minot. Kamida bitta mavzu kerak. Mos kalit so‘z sarlavha yoki RSS parchasida uchrasa, yangilik tanlanadi. Filtr so‘z chegaralarini tekshiradi: `AI` kaliti `said` so‘ziga mos kelmaydi. Kalit so‘zlarni `src/services/topics.ts` dan kengaytirish mumkin.

`/cancel` joriy suhbatni tugatadi. Suhbat davomida boshqa buyruq yuborilsa, joriy suhbat tugaydi va yangi buyruqni qayta yuborish so‘raladi. Sozlamalar to‘liq va to‘g‘ri kiritilgandan keyingina saqlanadi.

## Xabar formati

```text
📰 Sun’iy intellekt uchun yangi vosita taqdim etildi

Yangi vosita dasturchilarning kundalik ishlarini yengillashtirishga mo‘ljallangan. U dasturiy ta’minot yaratish jarayonida yordam beradi.

🔗 Manba: https://example.com/news

#AI #Texnologiya
```

Maqolaning to‘liq sahifasi yuklab olinmaydi. RSS’dan sarlavha va ko‘pi bilan 1400 belgilik parcha olinadi; faqat shu ma’lumot LLM’ga yuboriladi. Provayder barcha tillardagi manbalar uchun o‘zbekcha sarlavha va original xulosa tayyorlaydi. Tuzilish, uzunlik, lotin yozuvi, 2–3 gap va manbadan uzun ko‘chirmalar tekshiriladi. Tarjimaning ma’nosi va uslubiy sifati tanlangan modelga bog‘liq; avtomatik tekshiruv mukammal tilshunoslik nazorati emas.

LLM noto‘g‘ri, tugallanmagan yoki yaroqsiz javob bersa, maqola chiqarilmaydi. Matn uch urinishdan keyin ham tayyor bo‘lmasa, shu maqola o‘tkazib yuboriladi. Tayyor o‘zbekcha matn boshqa kanallarda qayta ishlatiladi, lekin har kanalning tanlovi, limiti va nashr tarixi alohida. HTML sarlavha, xulosa, kanal nomi va manba havolasida qochiriladi; Telegram xabarlari HTML rejimida yuboriladi.

## Ishonchlilik va cheklovlar

- Migratsiyalar ishga tushishda avtomatik, tranzaksiya ichida bajariladi. `npm run migrate` ularni alohida bajaradi. SQL fayllari tartib raqami bo‘yicha qo‘llanadi; keyingi o‘zgarish uchun yangi migratsiya qo‘shing.
- SQLite WAL rejimi, tashqi kalitlar va yozuv tranzaksiyalari yoqilgan.
- `publications(channel_id, news_id)` birlamchi kaliti bitta maqolaning bitta kanalga qayta yuborilishini to‘sadi.
- URL’dan kuzatuv parametrlari va fragment olib tashlanadi; sarlavha normallashtiriladi. URL yoki sarlavha xeshi avval ko‘rilgan bo‘lsa, maqola dublikat hisoblanadi. Bu mazmunan o‘xshash barcha maqolalarni aniqlaydigan semantik qidiruv emas.
- Telegram `sendMessage` uchun umumiy idempotentlik kaliti bermaydi. Shu sabab xabar yuborishdan **oldin** bazada band qilinadi. So‘rov natijasi noma’lum qolsa yoki jarayon shu payt uzilsa, yozuv `uncertain` yoki `reserved` bo‘lib qoladi va avtomatik qayta yuborilmaydi. Dublikatdan himoyalanish ayrim xabarlarning o‘tkazib yuborilishiga olib kelishi mumkin.
- `reserved` va `uncertain` yozuvlar ham band qilingan kundagi limitga kiradi. Kun `TIMEZONE` orqali aniqlanadi, odatda `Asia/Tashkent`. Taymerning tizim vaqt mintaqasiga bog‘liqligi yo‘q.
- Oxirgi nashr urinishi va `429` kutish muddati SQLite’da saqlanadi. Telegram `429` qaytarsa, band bo‘shatiladi va kanal `retry_after` tugagach keyingi vaqt oralig‘ida qayta olinishi mumkin. Boshqaruv so‘rovlari `auto-retry` orqali kutadi. Noaniq tarmoq va `5xx` nashr xatolari avtomatik takrorlanmaydi.
- Bot kanaldan chiqarilsa yoki nashr huquqi olib tashlansa, `my_chat_member` yangilanishi kanalni to‘xtatadi. Nashrdan oldingi tekshiruv va `403` xatolari ham holatni yangilaydi. Foydalanuvchi botni bloklasa, uning barcha kanallari to‘xtaydi; blokdan chiqarish ularni avtomatik yoqmaydi.
- Har bir aylanishda ko‘pi bilan 20 kanal, har kanal uchun ko‘pi bilan 3 matn tayyorlash urinishi bajariladi. Aylanishlar ustma-ust kelmaydi. Manba, tarjima xizmati yoki Telegram sekin ishlasa, nashr kechikishi mumkin.
- Nashrga mos yangi maqola bo‘lmasa, kanalga sun’iy yoki eski xabar chiqarilmaydi. Ishga tushganda yoshi `MAX_NEWS_AGE_HOURS` dan oshmagan maqolalar ham ko‘rib chiqiladi. Sana, sarlavha, havola yoki parcha bo‘lmagan RSS yozuvlari o‘tkazib yuboriladi.
- RSS manbalarini faqat operator `.env` orqali boshqaradi. Bir manba xatosi qolganlarini to‘xtatmaydi. Yuklash vaqti 15 soniya, RSS hajmi 2 MB bilan cheklangan.
- Nashr tarixi va dublikat kalitlari avtomatik o‘chirilmaydi. Ularni o‘chirish takroriy nashrga olib kelishi mumkin. Katta auditoriyada bazani kuzatish va keyinchalik PostgreSQL’ga o‘tish kerak bo‘ladi.

## Muhit parametrlari

| Parametr | Standart qiymat yoki mazmuni |
| --- | --- |
| `BOT_TOKEN` | Majburiy, BotFather tokeni |
| `DATABASE_PATH` | `./data/bot.sqlite` |
| `LOG_LEVEL` | `info` |
| `TIMEZONE` | `Asia/Tashkent` |
| `RSS_FEEDS` | Majburiy, 1–30 ta HTTP/HTTPS manba |
| `INGEST_INTERVAL_MINUTES` | `10`, RSS tekshirish oralig‘i |
| `SCHEDULER_TICK_SECONDS` | `15`, rejalashtiruvchi uyg‘onishi |
| `MAX_NEWS_AGE_HOURS` | `48`, yangilikning eng katta yoshi |
| `DEFAULT_DAILY_LIMIT` | `5`, yangi kanal kunlik limiti |
| `MAX_CHANNELS_PER_USER` | `10`, bitta hisob kanal chegarasi |
| `NEWS_LANGUAGE` | `uz-title` — o‘zbekcha dayjest, `uz` — LLM xulosasi, `en` — inglizcha dayjest |
| `LLM_ENABLED` | `true`, o‘zbekcha xulosa xizmatini yoqadi |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` |
| `LLM_API_KEY` | LLM yoqilganda majburiy |
| `LLM_MODEL` | LLM yoqilganda majburiy |
| `LLM_TIMEOUT_MS` | `45000`, LLM so‘rovi kutish chegarasi |
| `LLM_JSON_MODE` | `true`, JSON javob formatini so‘rash |

## Docker orqali ishga tushirish

Docker o‘rnatilgan kompyuter yoki serverda `.env` ni to‘ldirib:

```sh
docker compose up -d --build
docker compose logs -f bot
```

Konteyner `node` foydalanuvchisi sifatida ishlaydi. SQLite `bot_data` nomli doimiy hajmda saqlanadi. `Dockerfile` yig‘ish vaqtida qat’iy tip tekshiruvi, testlar va kompilyatsiyani bajaradi. Runtime ichiga faqat bajariladigan kod, migratsiyalar va zarur paketlar o‘tadi; `.env` obrazga ko‘chirilmaydi.

```sh
docker compose stop
docker compose start
```

`SIGINT` va `SIGTERM` kelganda yangi ish boshlash to‘xtatiladi, joriy ish tugashi kutiladi, keyin baza yopiladi. Uzoq Telegram cheklovida konteynerning kutish chegarasi tugashi mumkin; saqlangan bandlar qayta ishga tushganda dublikatni to‘sadi. Ma’lumotlarni saqlash uchun `docker compose down -v` ishlatmang.

## Tekshiruv va xizmat ko‘rsatish

```sh
npm run check
```

Bu buyruq manba va testlarni TypeScript `strict` rejimida tekshiradi, avtomatik testlarni bajaradi va `dist/` fayllarini yaratadi. Testlar haqiqiy Telegram yoki LLM hisobiga ulanmaydi va xabar yubormaydi. Ular izolyatsiya, dublikatlar, restart, kunlik limit, `429`, `403`, noaniq yuborish, HTML, LLM validatsiyasi va grammY suhbatlarini tekshiradi.

Pino jurnallari standart chiqishga JSON ko‘rinishida yoziladi. Tokenlar, LLM so‘rov tanasi va tarmoq xatosidagi maxfiy URL’lar jurnalga chiqarilmaydi. `npm ci` paketlarning `package-lock.json` dagi tekshirilgan versiyalarini o‘rnatadi.

Baza nusxasini olishdan oldin botni to‘xtating va `data/` jildini nusxalang. Ishlayotgan SQLite bazasining faqat asosiy `.sqlite` faylini ko‘chirish WAL’dagi yozuvlarni yo‘qotishi mumkin. Suhbat oqimi mos kelmaydigan tarzda o‘zgarsa, `src/bot.ts` dagi suhbat saqlash `version` qiymatini oshiring.

Yangi yangilik manbasi uchun `NewsSource.fetch()` implementatsiyasini yozib, `main.ts` dagi manbalar ro‘yxatiga qo‘shing. Boshqa LLM protokoli uchun `ContentWriter` implementatsiyasini almashtiring. Biznes xizmatlari bu provayderlarning aniq API’siga bog‘lanmagan.

## Rasmiy hujjatlar

- [grammY suhbatlari va tashqi amallar](https://grammy.dev/plugins/conversations)
- [grammY qayta urinish sozlamalari](https://grammy.dev/ref/auto-retry/autoretryoptions)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [rss-parser](https://github.com/rbren/rss-parser)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [OpenRouter Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
