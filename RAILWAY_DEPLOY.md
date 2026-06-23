# Deploy ke Railway

## File yang Diperlukan
- `Dockerfile` — build image Go
- `railway.toml` — konfigurasi Railway
- `.env.example` — referensi environment variable

## Langkah Deploy

### 1. Buka Railway
- [railway.app](https://railway.app) → Login pakai GitHub

### 2. Buat Project Baru
- Klik **New Project** → **Deploy from GitHub repo**
- Pilih repo `kyhosting/rest-api-kxk-wa`

### 3. Set Environment Variables
Di tab **Variables**, tambahkan:

| Key | Value |
|-----|-------|
| APP_PORT | ${{PORT}} |
| APP_HOST | 0.0.0.0 |
| APP_OS | GOWA |
| APP_DEBUG | false |
| WHATSAPP_WEBHOOK_SECRET | isi_sesuai_kebutuhan |

### 4. Tambah Volume (Persistent Storage)
Supaya session WhatsApp & database tidak hilang saat redeploy:

1. Di dashboard project → klik **+ New** → **Volume**
2. Buat 2 volume:
   - Volume 1: Mount Path → `/app/storages`
   - Volume 2: Mount Path → `/app/statics`
3. Klik **Deploy**

### 5. Generate Domain
- Tab **Settings** → **Networking** → **Generate Domain**
- App akan live di `https://xxxx.railway.app`

## Catatan Penting
- Session WhatsApp tersimpan di `/app/storages` — wajib pakai Volume
- Media tersimpan di `/app/statics` — tambah Volume supaya tidak hilang
- Railway free tier butuh kartu kredit (ada $5 kredit gratis)
