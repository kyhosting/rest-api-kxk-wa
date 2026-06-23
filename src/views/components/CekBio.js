export default {
    name: 'CekBio',
    data() {
        return {
            phoneInput: '',
            delayMs: 50,
            delayMode: 'standar',
            loading: false,
            cancelled: false,
            progress: 0,
            total: 0,
            currentPhone: '',
            stats: null,
            resultText: '',
            liveRegistered: 0,
            liveNotRegistered: 0,
            liveHasBio: 0,
            liveNoBio: 0,
            liveBusiness: 0,
        }
    },
    computed: {
        progressPercent() {
            if (!this.total) return 0;
            return Math.round((this.progress / this.total) * 100);
        },
        phoneLines() {
            return this.phoneInput
                .split(/[\n,;]+/)
                .map(l => l.trim())
                .filter(l => l.length > 0);
        }
    },
    methods: {
        openModal() {
            this.reset();
            $('#modalCekBio').modal({ closable: false }).modal('show');
        },
        reset() {
            this.phoneInput = '';
            this.loading = false;
            this.cancelled = false;
            this.progress = 0;
            this.total = 0;
            this.currentPhone = '';
            this.stats = null;
            this.resultText = '';
            this.liveRegistered = 0;
            this.liveNotRegistered = 0;
            this.liveHasBio = 0;
            this.liveNoBio = 0;
            this.liveBusiness = 0;
        },
        handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                this.phoneInput = e.target.result;
            };
            reader.readAsText(file);
            event.target.value = '';
        },
        normalizePhone(raw) {
            let p = raw.replace(/[\s\-\(\)\.]/g, '');
            if (p.startsWith('+')) p = p.slice(1);
            if (p.startsWith('0')) p = '62' + p.slice(1);
            return p;
        },
        sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        },
        pad(n) {
            return String(n).padStart(2, '0');
        },
        formatDateTime(d) {
            return `${this.pad(d.getDate())}/${this.pad(d.getMonth()+1)}/${d.getFullYear()} ${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
        },
        getTierCategory(tier) {
            const t = (tier || '').toLowerCase().replace(/[_\-\s]/g, '');
            if (t.includes('exclusive') || t.includes('eksklusif')) return 'exclusive';
            if (t.includes('suite')) return 'suite';
            if (t.includes('standard') || t.includes('standar')) return 'standard';
            return 'low';
        },
        getTierLabel(tier, hasVerifiedName) {
            const cat = this.getTierCategory(tier);
            if (cat === 'exclusive') return 'Eksklusif Meta Business';
            if (cat === 'suite') return 'Suite Meta Business';
            if (cat === 'standard') return 'Standart Meta Business';
            return 'Low Meta Business';
        },
        extractMemberSinceYear(memberSince) {
            if (!memberSince) return null;
            const m = memberSince.match(/\b(20\d{2})\b/);
            if (m) return parseInt(m[1]);
            return null;
        },
        async checkOne(rawPhone) {
            const phone = this.normalizePhone(rawPhone);
            const jid = phone + '@s.whatsapp.net';
            const checkTime = new Date();
            const result = {
                raw: rawPhone,
                phone,
                jid,
                registered: false,
                bio: '',
                isBusiness: false,
                business: null,
                name: '',
                checkTime,
            };

            try {
                const checkRes = await window.http.get('/user/check', { params: { phone: jid } });
                result.registered = checkRes.data.results.is_on_whatsapp;
            } catch {
                result.registered = false;
                return result;
            }

            if (!result.registered) return result;

            try {
                const infoRes = await window.http.get('/user/info', { params: { phone: jid } });
                const data = infoRes.data.results?.data;
                if (data && data.length > 0) {
                    result.bio = data[0].status || '';
                    result.name = data[0].verified_name || data[0].name || '';
                    result.pictureId = data[0].picture_id || '';
                    // status_at is Unix timestamp (seconds); 0 or negative means not set
                    const sat = data[0].status_at;
                    if (sat && sat > 0) {
                        result.bioSetAt = new Date(sat * 1000);
                    }
                }
            } catch { /* ignore */ }

            try {
                const bizRes = await window.http.get('/user/business-profile', { params: { phone: jid } });
                const biz = bizRes.data.results;
                if (biz && biz.jid) {
                    result.isBusiness = true;
                    const opts = biz.profile_options || {};

                    // Business name: prefer backend extracted, then verified_name from info, then categories
                    const bizName = biz.business_name || result.name || '';

                    // Member since
                    const memberSince = biz.member_since || opts['member_since_text'] || opts['member_since'] || '';

                    // Cover ID
                    const coverID = biz.cover_id || opts['cover_low_res_url'] || opts['cover_high_res_url'] || opts['cover_id'] || opts['cover'] || '';

                    // Tier - check backend extracted, then profile_options
                    const rawTier = biz.tier || opts['tier'] || opts['business_tier'] || opts['biz_tier'] || opts['verified_tier'] || opts['verified_level'] || opts['level'] || '';

                    result.business = {
                        name: bizName,
                        memberSince,
                        coverID,
                        rawTier,
                        category: biz.categories?.length ? biz.categories.map(c => c.name).join(', ') : '',
                        email: biz.email || '',
                        address: biz.address || '',
                        description: biz.description || opts['description'] || '',
                        website: biz.website || opts['website'] || '',
                        hasCatalog: opts['cart_enabled'] === 'true',
                        profileOptions: opts,
                    };
                }
            } catch { /* not a business */ }

            return result;
        },
        async startProcess() {
            const lines = this.phoneLines;
            if (lines.length === 0) {
                showErrorInfo('Masukkan nomor telepon terlebih dahulu');
                return;
            }

            this.loading = true;
            this.cancelled = false;
            this.total = lines.length;
            this.progress = 0;
            this.liveRegistered = 0;
            this.liveNotRegistered = 0;
            this.liveHasBio = 0;
            this.liveNoBio = 0;
            this.liveBusiness = 0;
            this.stats = null;
            this.resultText = '';

            const withBio = [];
            const withoutBio = [];
            const notRegistered = [];

            for (let i = 0; i < lines.length; i++) {
                if (this.cancelled) break;

                this.currentPhone = lines[i];
                const res = await this.checkOne(lines[i]);
                this.progress = i + 1;

                if (!res.registered) {
                    notRegistered.push(res);
                    this.liveNotRegistered++;
                } else {
                    this.liveRegistered++;
                    if (res.isBusiness) this.liveBusiness++;
                    if (res.bio && res.bio.trim()) {
                        withBio.push(res);
                        this.liveHasBio++;
                    } else {
                        withoutBio.push(res);
                        this.liveNoBio++;
                    }
                }

                if (i < lines.length - 1 && !this.cancelled) {
                    await this.sleep(this.delayMs);
                }
            }

            this.loading = false;
            this.currentPhone = '';

            const totalChecked = this.cancelled ? this.progress : lines.length;
            const totalRegistered = withBio.length + withoutBio.length;
            const allBusiness = [
                ...withBio.filter(r => r.isBusiness),
                ...withoutBio.filter(r => r.isBusiness),
            ];

            // Count tier breakdown
            const tierCounts = { low: 0, standard: 0, exclusive: 0, suite: 0 };
            allBusiness.forEach(r => {
                const cat = this.getTierCategory(r.business?.rawTier);
                tierCounts[cat]++;
            });

            // Year-based stats from bio entries (prefer bioSetAt, fallback to memberSince year, else checkTime)
            const yearStats = {};
            withBio.forEach(r => {
                let year = null;
                if (r.bioSetAt) {
                    year = r.bioSetAt.getFullYear();
                } else if (r.isBusiness && r.business?.memberSince) {
                    year = this.extractMemberSinceYear(r.business.memberSince);
                }
                if (!year) year = r.checkTime.getFullYear();
                yearStats[year] = (yearStats[year] || 0) + 1;
            });

            this.stats = {
                total: totalChecked,
                registered: totalRegistered,
                notRegistered: notRegistered.length,
                hasBio: withBio.length,
                noBio: withoutBio.length,
                business: allBusiness.length,
                tierLow: tierCounts.low,
                tierStandard: tierCounts.standard,
                tierExclusive: tierCounts.exclusive,
                tierSuite: tierCounts.suite,
                yearStats,
                cancelled: this.cancelled,
            };

            this.resultText = this.buildResultText(withBio, withoutBio, notRegistered, totalChecked, totalRegistered, tierCounts, yearStats);

            if (!this.cancelled) {
                showSuccessInfo(`Selesai! ${totalRegistered} terdaftar dari ${totalChecked} nomor.`);
            }
        },
        setMode(mode) {
            this.delayMode = mode;
            if (mode === 'low') this.delayMs = 20;
            else if (mode === 'standar') this.delayMs = 50;
            else if (mode === 'fast') this.delayMs = 100;
        },
        cancelProcess() {
            this.cancelled = true;
        },
        buildResultText(withBio, withoutBio, notRegistered, totalChecked, totalRegistered, tierCounts, yearStats) {
            const now = new Date();
            const dateStr = this.formatDateTime(now);
            const businessTotal = withBio.filter(r => r.isBusiness).length + withoutBio.filter(r => r.isBusiness).length;

            let txt = '';
            txt += '╔═══════════════════════════════════════╗\n';
            txt += '║        HASIL CEK BIO WHATSAPP         ║\n';
            txt += '╚═══════════════════════════════════════╝\n';
            txt += `Generated: ${dateStr}\n`;
            txt += '\n';
            txt += `Total Nomor Dicek    : ${totalChecked}\n`;
            txt += `Terdaftar di WA      : ${totalRegistered}\n`;
            txt += `Tidak Terdaftar WA   : ${notRegistered.length}\n`;
            txt += `Memiliki Bio         : ${withBio.length}\n`;
            txt += `Tanpa Bio            : ${withoutBio.length}\n`;
            txt += `Business Meta        : ${businessTotal}\n`;
            txt += '\n';
            txt += '═══════════════════════════════════════\n';
            txt += '\n';

            // Entries with bio
            txt += `[ NOMOR DENGAN BIO (${withBio.length}) ]\n\n`;
            withBio.forEach((r, idx) => {
                const checkTimeStr = this.formatDateTime(r.checkTime);
                const bioTimeStr = r.bioSetAt ? `Set: ${this.formatDateTime(r.bioSetAt)}` : `Dicek: ${checkTimeStr}`;
                if (r.isBusiness && r.business) {
                    const tierLabel = this.getTierLabel(r.business.rawTier);
                    txt += `[${idx+1}] Nomor: +${r.phone} (${tierLabel})\n`;
                    txt += `Bio: ${r.bio}\n`;
                    txt += `${bioTimeStr}\n`;
                    txt += `Business Details:\n`;
                    const bname = r.business.name || '-';
                    const since = r.business.memberSince || '-';
                    const cover = r.business.coverID || '-';
                    const catalog = r.business.hasCatalog ? 'Katalog tersedia' : 'Tidak ada katalog';
                    txt += `    ├ Name: ${bname}\n`;
                    txt += `    ├ Since: ${since}\n`;
                    txt += `    ├ Katalog: ${catalog}\n`;
                    txt += `    └ Cover: ${cover}\n`;
                } else {
                    txt += `[${idx+1}] Nomor: +${r.phone}\n`;
                    txt += `Bio: ${r.bio}\n`;
                    txt += `${bioTimeStr}\n`;
                }
                txt += '\n';
            });

            txt += '\n';

            // Entries without bio (registered)
            txt += `[ NOMOR TANPA BIO - Terdaftar (${withoutBio.length}) ]\n\n`;
            withoutBio.forEach((r, idx) => {
                if (r.isBusiness && r.business) {
                    const tierLabel = this.getTierLabel(r.business.rawTier);
                    txt += `${idx+1}. +${r.phone} (${tierLabel})\n`;
                } else {
                    txt += `${idx+1}. +${r.phone}\n`;
                }
            });

            txt += '\n';

            // Not registered
            txt += `[ NOMOR TIDAK TERDAFTAR WA (${notRegistered.length}) ]\n\n`;
            notRegistered.forEach((r, idx) => {
                txt += `${idx+1}. +${r.phone}\n`;
            });

            txt += '\n';
            txt += '═══════════════════════════════════════\n';
            txt += 'Statistik Ringkasan:\n';
            txt += `- Terdaftar WA         : ${totalRegistered}\n`;
            txt += `- Tidak Terdaftar WA   : ${notRegistered.length}\n`;
            txt += `- Memiliki Bio         : ${withBio.length}\n`;
            txt += `- Tanpa Bio            : ${withoutBio.length}\n`;
            if (businessTotal > 0) {
                txt += `- Business Meta        : ${businessTotal}\n`;
                txt += `  ├ Eksklusif          : ${tierCounts.exclusive}\n`;
                txt += `  ├ Standart           : ${tierCounts.standard}\n`;
                txt += `  ├ Low                : ${tierCounts.low}\n`;
                txt += `  └ Suite              : ${tierCounts.suite}\n`;
            } else {
                txt += `- Business Meta        : 0\n`;
            }

            // Year stats
            const years = Object.keys(yearStats).sort();
            if (years.length > 0) {
                txt += '\n';
                txt += 'Statistik Bio Berdasarkan Tahun Set Bio:\n';
                years.forEach(year => {
                    txt += `- ${year}              : ${yearStats[year]}\n`;
                });
            }

            txt += '═══════════════════════════════════════\n';

            return txt;
        },
        downloadResult() {
            if (!this.resultText) return;
            const now = new Date();
            const ts = `${now.getFullYear()}${this.pad(now.getMonth()+1)}${this.pad(now.getDate())}_${this.pad(now.getHours())}${this.pad(now.getMinutes())}${this.pad(now.getSeconds())}`;
            const blob = new Blob([this.resultText], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cekbio_result_${ts}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
    },
    template: `
    <div class="teal card" @click="openModal" style="cursor: pointer;">
        <div class="content">
            <a class="ui teal right ribbon label">Tools</a>
            <div class="header">
                <i class="search icon"></i> Cek Bio Massal
            </div>
            <div class="description">
                Cek bio, status & profil bisnis WA banyak nomor sekaligus
            </div>
        </div>
    </div>

    <div class="ui large modal" id="modalCekBio" style="overflow:visible;">
        <i class="close icon" @click="$('#modalCekBio').modal('hide')"></i>
        <div class="header">
            <i class="search icon"></i> Cek Bio WhatsApp Massal
        </div>
        <div class="scrolling content" style="max-height: 75vh; overflow-y: auto;">

            <!-- Input Section -->
            <div v-if="!loading && !stats" class="ui form">
                <div class="field">
                    <label>Daftar Nomor Telepon</label>
                    <textarea v-model="phoneInput" rows="10"
                        placeholder="Masukkan nomor satu per baris, contoh:&#10;628123456789&#10;+62 812-3456-789&#10;081234567890"></textarea>
                    <div class="ui info message" style="margin-top:6px; padding: 8px 12px;">
                        <i class="info circle icon"></i>
                        Satu nomor per baris. Format bebas: bisa dengan +62, 08, atau 62 langsung.
                    </div>
                </div>
                <div class="two fields">
                    <div class="field">
                        <label>Upload File TXT</label>
                        <input type="file" accept=".txt,.csv" id="cekbio_file" @change="handleFileUpload" style="display:none"/>
                        <label for="cekbio_file" class="ui blue button" style="cursor:pointer; display:inline-block; margin-top:4px;">
                            <i class="upload icon"></i> Pilih File
                        </label>
                        <span v-if="phoneLines.length > 0" style="margin-left:10px; color:#666;">
                            {{ phoneLines.length }} nomor terdeteksi
                        </span>
                    </div>
                    <div class="field">
                        <label>Mode Kecepatan</label>
                        <div class="ui three buttons" style="margin-bottom:8px;">
                            <button class="ui button" :class="{green: delayMode==='low'}" @click="setMode('low')">
                                <i class="leaf icon"></i> LOW<br>
                                <small style="font-weight:normal; font-size:10px;">20ms / cek</small>
                            </button>
                            <button class="ui button" :class="{yellow: delayMode==='standar'}" @click="setMode('standar')">
                                <i class="balance scale icon"></i> STANDAR<br>
                                <small style="font-weight:normal; font-size:10px;">50ms / cek</small>
                            </button>
                            <button class="ui button" :class="{red: delayMode==='fast'}" @click="setMode('fast')">
                                <i class="bolt icon"></i> FAST<br>
                                <small style="font-weight:normal; font-size:10px;">100ms / cek</small>
                            </button>
                        </div>
                        <div class="ui mini label" style="display:inline-block;">
                            Delay aktif: <b>{{ delayMs }} ms</b>
                        </div>
                        &nbsp;
                        <input type="number" v-model.number="delayMs" min="1" max="9999" step="10"
                            style="width:90px; display:inline-block;"
                            @input="delayMode='custom'"
                            title="Custom delay (ms)"/>
                        <span style="font-size:11px; color:#888; margin-left:4px;">ms (custom)</span>
                    </div>
                </div>

                <div v-if="phoneLines.length > 0" class="ui segment" style="background:#f8f9fa;">
                    <b>Preview nomor ({{ phoneLines.length }} total):</b>
                    <div style="max-height:100px; overflow-y:auto; margin-top:8px; font-family:monospace; font-size:12px;">
                        <div v-for="(p, i) in phoneLines.slice(0, 10)" :key="i">{{ p }}</div>
                        <div v-if="phoneLines.length > 10" style="color:#888;">... dan {{ phoneLines.length - 10 }} nomor lainnya</div>
                    </div>
                </div>

                <button class="ui teal large button" :class="{disabled: phoneLines.length === 0}" @click="startProcess" style="margin-top:12px;">
                    <i class="play icon"></i> Mulai Cek ({{ phoneLines.length }} nomor)
                </button>
            </div>

            <!-- Progress Section -->
            <div v-if="loading">
                <div class="ui segment">
                    <h4 class="ui header">
                        <i class="spinner loading icon"></i>
                        Sedang Memproses...
                    </h4>
                    <div class="ui indicating progress" :data-percent="progressPercent" style="margin:12px 0;">
                        <div class="bar" :style="{width: progressPercent + '%', minWidth: '0', transition: 'width 0.3s ease'}">
                            <div class="progress">{{ progressPercent }}%</div>
                        </div>
                        <div class="label">{{ progress }} / {{ total }} nomor — <i>{{ currentPhone }}</i></div>
                    </div>

                    <div class="ui four statistics mini" style="margin-top:16px;">
                        <div class="statistic">
                            <div class="value green">{{ liveRegistered }}</div>
                            <div class="label">Terdaftar WA</div>
                        </div>
                        <div class="statistic">
                            <div class="value red">{{ liveNotRegistered }}</div>
                            <div class="label">Tidak Terdaftar</div>
                        </div>
                        <div class="statistic">
                            <div class="value blue">{{ liveHasBio }}</div>
                            <div class="label">Punya Bio</div>
                        </div>
                        <div class="statistic">
                            <div class="value orange">{{ liveBusiness }}</div>
                            <div class="label">Business WA</div>
                        </div>
                    </div>

                    <button class="ui red button" @click="cancelProcess" style="margin-top:16px;">
                        <i class="stop icon"></i> Batalkan
                    </button>
                </div>
            </div>

            <!-- Result Section -->
            <div v-if="stats && !loading">
                <div v-if="stats.cancelled" class="ui warning message">
                    <i class="warning icon"></i>
                    Proses dibatalkan pada nomor ke-{{ progress }}.
                </div>

                <!-- Summary Cards Row 1 -->
                <div class="ui four statistics">
                    <div class="statistic">
                        <div class="value">{{ stats.total }}</div>
                        <div class="label">Total Dicek</div>
                    </div>
                    <div class="statistic green">
                        <div class="value">{{ stats.registered }}</div>
                        <div class="label">Terdaftar WA</div>
                    </div>
                    <div class="statistic red">
                        <div class="value">{{ stats.notRegistered }}</div>
                        <div class="label">Tidak Terdaftar</div>
                    </div>
                    <div class="statistic blue">
                        <div class="value">{{ stats.hasBio }}</div>
                        <div class="label">Punya Bio</div>
                    </div>
                </div>

                <!-- Summary Cards Row 2 -->
                <div class="ui three statistics" style="margin-top:0;">
                    <div class="statistic">
                        <div class="value">{{ stats.noBio }}</div>
                        <div class="label">Tanpa Bio</div>
                    </div>
                    <div class="statistic orange">
                        <div class="value">{{ stats.business }}</div>
                        <div class="label">WA Business</div>
                    </div>
                    <div class="statistic teal">
                        <div class="value">{{ stats.registered > 0 ? Math.round(stats.hasBio / stats.registered * 100) : 0 }}%</div>
                        <div class="label">% Punya Bio</div>
                    </div>
                </div>

                <!-- Business Tier Breakdown -->
                <div v-if="stats.business > 0" class="ui segment" style="margin-top:8px; padding:12px 16px;">
                    <div style="font-weight:bold; margin-bottom:8px; color:#e67e22;">
                        <i class="briefcase icon"></i> Breakdown Tier Business Meta ({{ stats.business }})
                    </div>
                    <div class="ui four statistics mini">
                        <div class="statistic">
                            <div class="value purple">{{ stats.tierExclusive }}</div>
                            <div class="label">Eksklusif</div>
                        </div>
                        <div class="statistic">
                            <div class="value blue">{{ stats.tierStandard }}</div>
                            <div class="label">Standart</div>
                        </div>
                        <div class="statistic">
                            <div class="value green">{{ stats.tierLow }}</div>
                            <div class="label">Low</div>
                        </div>
                        <div class="statistic">
                            <div class="value teal">{{ stats.tierSuite }}</div>
                            <div class="label">Suite</div>
                        </div>
                    </div>
                </div>

                <!-- Year Stats -->
                <div v-if="Object.keys(stats.yearStats).length > 0" class="ui segment" style="margin-top:8px; padding:12px 16px;">
                    <div style="font-weight:bold; margin-bottom:8px; color:#2980b9;">
                        <i class="calendar icon"></i> Statistik Bio Berdasarkan Tahun Set Bio
                    </div>
                    <div class="ui horizontal list">
                        <div v-for="(count, year) in stats.yearStats" :key="year" class="item">
                            <div class="ui blue label">{{ year }}: <b>{{ count }}</b></div>
                        </div>
                    </div>
                </div>

                <!-- Result Text Preview -->
                <div class="ui segment" style="margin-top:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <b><i class="file text icon"></i> Hasil (preview)</b>
                        <div>
                            <button class="ui teal button" @click="downloadResult">
                                <i class="download icon"></i> Download TXT
                            </button>
                            <button class="ui button" @click="reset" style="margin-left:8px;">
                                <i class="redo icon"></i> Cek Lagi
                            </button>
                        </div>
                    </div>
                    <textarea readonly :value="resultText" rows="14"
                        style="width:100%; font-family:monospace; font-size:11px; background:#1e1e1e; color:#d4d4d4; border:none; border-radius:4px; padding:10px; resize:vertical;"></textarea>
                </div>
            </div>

        </div>
        <div class="actions">
            <div class="ui button" @click="$('#modalCekBio').modal('hide')">Tutup</div>
        </div>
    </div>
    `
}
