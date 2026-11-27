# Telegram AI & Tech News Bot

A multi-channel Telegram bot that collects RSS stories about AI and technology. By default, it translates headlines into Uzbek Latin script with MyMemory and publishes a digest with up to three clickable headlines. The channel owner's publishing schedule and history are stored separately for each channel.

## What the bot does

- Verifies channel ownership and the bot's posting permission before connecting a channel.
- Filters stories by topic and deduplicates them by normalized title and canonical URL.
- Publishes 1–5 digests per channel per day between 09:00 and 21:00. For three daily posts, the publication windows start at 09:00, 13:00, and 17:00 in Asia/Tashkent.
- Places the destination channel's username or display name at the end of each digest and disables article link previews.
- Supports local long polling with SQLite and hosted Telegram webhooks with PostgreSQL.

## Run locally

You need Node.js 24 (minimum 22.12), npm, and a Telegram token from [BotFather](https://t.me/BotFather).

```sh
npm ci
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` to create the file and `npm.cmd` if `npm` is blocked by script execution policy. Keep an existing `.env` and add any missing keys from the example.

Set `BOT_TOKEN` and `RSS_FEEDS`. The example uses English feeds and enables Uzbek title translation without an LLM key.

```sh
npm run check
npm start
```

Use `npm run dev` to restart the local bot when source files change. The database is created and migrated automatically. Run `npm run migrate` to apply the migrations separately.

## Connect a Telegram channel

1. Talk to the bot in a private chat and send `/start`.
2. Give the bot administrator access to your channel and enable its permission to post messages.
3. Send `/connect` from the channel owner's Telegram account. Enter the channel's `@username`, its numeric ID starting with `-100`, or an original forwarded channel message.
4. Use `/channels` and choose **Boshlash** to enable publishing. **To‘xtatish** pauses future digests.
5. Open **Sozlamalar** or use `/settings` to choose a daily limit and comma-separated topic codes. Available codes are `ai`, `technology`, `cybersecurity`, `software`, and `gadgets`.

Use `/channels` to view the planned times and `/cancel` to exit an active setup conversation. After restoring lost channel permissions, reconnect the channel, then enable publishing again.

### Example digest

```text
AI va texnologiyada nima gap?
Hozirgi soatgacha bo‘lgan yangiliklar:

● Dasturchilar uchun yangi sun’iy intellekt vositalari taqdim etildi
● Ochiq kodli modelning yangi versiyasi chiqdi
● Yangi avlod chipi namoyish etildi

@your_channel
```

Each headline links to its article. A digest counts as one post, regardless of how many headlines it contains. Publishing requires matching stories. Failed translations are skipped, and successful translations are cached in the database.

## Deploy on Render Free

This setup uses a Render **Web Service**, a Neon **Free** PostgreSQL database, and GitHub Actions for scheduling. A free Render web service sleeps when idle. Telegram webhook requests and scheduled publishing requests wake the service when needed. A cold start or a delayed GitHub Actions run can shift the actual posting time within a publication window. [Render Free limitations](https://render.com/docs/free) · [Neon plans](https://neon.com/pricing)

1. Create a Neon Free project. Copy the pooled connection string for `DATABASE_URL` and the direct connection string for `DATABASE_URL_UNPOOLED`. Keep the SSL settings in Neon's connection strings.
2. If moving an existing SQLite installation, stop the local bot before the final import. Set the direct PostgreSQL URL locally and run `npm run db:import` before deploying. The command reads the local `DATABASE_PATH`, preserves channel settings, stories, deduplication keys, publication history, and conversations, and aborts if the target tables already contain data. For a new installation, skip the import. The database remains in PostgreSQL across Render restarts.
3. In Render, create a **Web Service** from this repository. Select **Node**, the **Free** instance type, and branch `main`. Set the build command to `npm ci --include=dev && npm run check`, the start command to `npm start`, and the health check path to `/health`.
4. Add the following in the Render service's **Environment** settings:

   | Variable | Value |
   | --- | --- |
   | `NODE_VERSION` | `24.12.0` |
   | `BOT_MODE` | `webhook` |
   | `BOT_TOKEN` | Your BotFather token |
   | `DATABASE_URL` | Neon pooled connection string |
   | `DATABASE_URL_UNPOOLED` | Neon direct connection string for migrations |
   | `RSS_FEEDS` | Comma-separated RSS URLs from your local configuration |
   | `NEWS_LANGUAGE` | `uz-title` |
   | `LLM_ENABLED` | `false` |
   | `TIMEZONE` | `Asia/Tashkent` |
   | `WEBHOOK_SECRET` | A random secret of at least 32 characters using letters, numbers, underscores, or hyphens |
   | `SCHEDULER_SECRET` | A different random secret in the same format |

   Run `node -p "require('node:crypto').randomBytes(32).toString('hex')"` twice to generate separate secrets. Render supplies `PORT` and `RENDER_EXTERNAL_URL` automatically. Set `WEBHOOK_BASE_URL` explicitly if using a different base URL.
5. In GitHub **Settings → Secrets and variables → Actions**, create the repository variable `RENDER_SERVICE_URL` with the Render HTTPS URL and the repository secret `SCHEDULER_SECRET` with the same value used on Render. Enable Actions if GitHub prompts you. The scheduled workflow must be on the default branch.
6. Check `GET /health` and the Render logs, then send `/channels` to the Telegram bot. In GitHub Actions, run **Publish news** manually to verify the scheduler request. A manual run can publish eligible digests to enabled channels during the daytime window.

The [publishing workflow](.github/workflows/publish.yml) runs a few minutes after the start of each supported Asia/Tashkent publication window. PostgreSQL records each channel's window claim so repeated requests cannot cause a second digest for that window. If you change `TIMEZONE`, update the workflow's UTC schedule as well. GitHub can delay scheduled workflows and disables scheduled runs on inactive public repositories after 60 days. [GitHub scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

Keep the local polling process stopped once the Render webhook is active. Starting local polling for the same token removes the Telegram webhook. Store credentials in the respective secret settings. Git ignores `.env` and local SQLite files.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `BOT_MODE` | `polling` (default) or `webhook` |
| `DATABASE_PATH` | Local SQLite path, defaults to `./data/bot.sqlite` |
| `DATABASE_URL` | Enables PostgreSQL. Required in webhook mode |
| `DATABASE_URL_UNPOOLED` | Optional direct connection for migration and import |
| `RSS_FEEDS` | 1–30 comma-separated HTTP or HTTPS feeds |
| `TIMEZONE` | Scheduling and daily post limits, defaults to `Asia/Tashkent` |
| `DEFAULT_DAILY_LIMIT` | Daily limit for new channels, between 1 and 5 |
| `MAX_NEWS_AGE_HOURS` | Maximum story age, defaults to 48 hours |
| `MAX_CHANNELS_PER_USER` | Channel limit per owner, defaults to 10 |
| `NEWS_LANGUAGE` | `uz-title` for Uzbek digest headlines, `en` for original English headlines, or `uz` for LLM-generated Uzbek headlines and summaries |
| `LLM_ENABLED` | Enables the summary service in `uz` mode |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | OpenAI-compatible service settings in `uz` mode |
| `LLM_TIMEOUT_MS`, `LLM_JSON_MODE` | LLM timeout and JSON response option |
| `SCHEDULER_TICK_SECONDS` | How often the local polling process checks the schedule, defaults to 15 |
| `INGEST_INTERVAL_MINUTES` | Minimum time between RSS refreshes in a running process, defaults to 10 |
| `LOG_LEVEL` | Pino logging level, defaults to `info` |

MyMemory's anonymous quota is 5,000 characters per day. The bot sends only public RSS titles for translation. It does not fetch full articles. [MyMemory quota](https://mymemory.translated.net/doc/usagelimits.php)

## Development and verification

`src/bot.ts` registers grammY's Telegram handlers and persistent conversations. `src/services/` handles RSS, translation, publication windows, and sending. `src/db/` contains both repositories, versioned migrations, and the import command. `src/web-server.ts` serves the Telegram webhook, health check, and authenticated scheduler endpoint.

The bot reserves each story in the database before sending a digest. It releases reservations on definitive Telegram rejections and respects the `retry_after` value on HTTP 429. If delivery is uncertain, it keeps the reservation to avoid resending a digest that might already have been published.

```sh
npm run check
```

To run the PostgreSQL integration test, set `TEST_POSTGRES_URL` to a disposable PostgreSQL database that allows schema creation and run `npm test`. The test creates and removes an isolated schema. The normal test suite requires no Telegram token or third-party account. For local Docker usage, fill `.env` and run `docker compose up -d --build`.

For a local SQLite backup, stop the bot and copy the `data/` directory. If a conversation flow changes incompatibly, increment the conversation storage version in `src/bot.ts`.
