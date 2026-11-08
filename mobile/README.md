# GenOffice untuk Android

Membungkus renderer GenOffice (Docs, Sheets, Slides, PDF, Markdown, HTML) sebagai web app di dalam
WebView Android memakai [Capacitor](https://capacitorjs.com). Electron tidak ada di Android, jadi
preload/IPC diganti oleh `shim/android-shim.js`, sedangkan tampilan desktop, tab dokumen, dan
penyimpanan file ditangani oleh shell di `shell/`.

**AI sengaja tidak disertakan di build Android.** Kode panel AI bawaan renderer desktop tetap ada di
bundle, tetapi seluruh entry point, menu, dock, dan panelnya disembunyikan; preferensi AI dipaksa
mati dan tidak ada IPC/network AI yang didaftarkan.

## Status build

Sudah diverifikasi di perangkat Android 16 (arm64, SDK 36) dengan APK debug ±40 MB:

- Shell desktop tampil dengan sidebar, sapaan, quick-create, Recent/Starred/Files, dan tab dokumen.
- Status bar disembunyikan saat aplikasi foreground; WebView memakai edge-to-edge dan navigation bar
  bersifat swipe-to-reveal.
- Pinch dua jari diterjemahkan menjadi `wheel` + `ctrlKey`. Diuji di Sheets: zoom 1.47 → 1.94 tanpa
  mengubah zoom halaman browser.
- Tab dokumen bertahan setelah aplikasi di-force-stop lalu dibuka lagi, termasuk tab `.pptx`.
- Docs: buat, edit, Save, Save As, tutup, buka ulang; hasil `.docx` valid.
- Sheets: buka/edit/simpan `.xlsx`; formula, style, merge, lebar kolom, dan sheet lain tetap ada.
- Markdown: buka, edit, simpan; isi file berubah di disk.
- HTML: preview berjalan, mode Split/Source, edit, simpan; isi file berubah di disk.
- PDF: buka dan render halaman (canvas + text layer).
- Slides: buka `.pptx`, render slide, edit teks/judul, font, fill, stroke, text anchor, tabel, chart,
  gambar, duplicate/delete slide, undo/redo, Save, Save As, dan buka ulang. Roundtrip `.pptx`
  terverifikasi di perangkat; AutoSave 30 detik juga menulis perubahan ke disk.
- AI: tidak ada entry point yang terlihat di Docs, Sheets, maupun Slides; menu kontekstual AI
  (Synonyms/Translate) dan grup Review Translate ikut disembunyikan.

File disimpan di `Documents/GenOffice/`. AutoSave default-nya **aktif** karena belum ada dialog
"simpan sebelum keluar"; matikan lewat tombol AutoSave di tiap app bila perlu.

| App | Buka | Simpan | Catatan |
| --- | --- | --- | --- |
| Docs | `.docx` | Ya | AutoSave, Save, Save As; roundtrip terverifikasi |
| Sheets | `.xlsx` | Ya | SheetJS untuk baca, ExcelJS untuk simpan; style/merge/width/part lain dipertahankan |
| Markdown | `.md`, `.markdown`, `.txt` | Ya | Save dan Save As |
| HTML | `.html`, `.htm` | Ya | Preview same-origin, script halaman ikut jalan |
| PDF | `.pdf` | Tidak | Hanya baca; anotasi/form/edit belum disimpan |
| Slides | `.pptx` | Ya | Engine PPTX asli dijalankan di WebView; roundtrip teks/tabel/chart/gambar terverifikasi |

## Arsitektur Android

```
shell/index.html, shell.js, shell.css   desktop-like home + tab strip
shim/android-shim.js                    pengganti API Electron + proxy Filesystem untuk iframe
shim/touch-zoom.js                      pinch dua jari -> synthetic wheel + ctrlKey
shim/html-preview.html                  preview HTML same-origin
slides-host/src/entry.ts                host Slides: main+preload asli, adapter dialog/VFS
slides-host/src/electron-stub.ts        Electron IPC/contextBridge/browser-window di dalam WebView
slides-host/src/vfs.ts                  filesystem in-memory untuk engine PPTX
slides-host/src/stubs/                  modul desktop-only (AI, print, PDF export) yang inert
scripts/build-web.mjs                   build renderer terpilih + build Slides host + copy shell
scripts/build-slides-host.mjs           bundle host Slides dengan esbuild
scripts/patch-android.mjs               patch MainActivity/styles untuk immersive fullscreen
```

Setiap tab dokumen adalah iframe same-origin yang tetap hidup saat tab lain dipilih. Capacitor hanya
menyuntikkan native bridge ke dokumen utama, jadi shim mem-proxy panggilan `Filesystem` dari iframe
lewat shell. Dengan cara ini Docs/Sheets/Markdown/HTML tetap bisa membaca dan menulis file asli
selama tab-nya aktif.

Urutan buka file: shell membuat tab, menyimpan `File` sebentar di IndexedDB (atau meneruskan `path`),
lalu iframe app mengambil byte melalui shim. Docs memakai blob URL sekali pakai; HTML memakai
`shim/html-preview.html` karena skema `html-preview://` tidak ada di WebView.

## Cara build

Butuh Node 22+, JDK 21, dan Android SDK 35/36 (`platform-tools`, `platforms;android-35`,
`build-tools;35.0.0`).

```sh
# dari root repo
npm ci --ignore-scripts
(cd mobile && npm ci)
node mobile/scripts/build-web.mjs

cd mobile
npx cap add android          # sekali saja; folder android/ tidak di-commit
npx cap sync android
node scripts/patch-android.mjs
cd android
./gradlew assembleDebug --no-daemon
```

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

Install di HP:

```sh
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Atau pakai workflow **Actions → Android APK → Run workflow** lalu unduh artifact
`genoffice-debug-apk`.

APK verifikasi terakhir:

```
SHA-256 15e743fa988e79dcf7b5a6e14ab8d7a28d30ef2491d304e4021c566429302d3f
```

Build APK tersebut dibuat setelah `cap sync` dari `mobile/www` lengkap (Docs, Sheets, Slides, PDF,
Markdown, HTML) dan sudah dipasang dengan `pm install -r` tanpa menghapus data aplikasi.

### Catatan host ARM64

Android build-tools resmi menyertakan `aapt2` x86_64. Kalau build dijalankan di host aarch64
(mis. Termux/box64), bungkus `aapt2` lalu beri Gradle path wrapper:

```sh
mkdir -p /tmp/android-tools
cat > /tmp/android-tools/aapt2 <<'EOF'
#!/bin/sh
exec box64 "$ANDROID_HOME/build-tools/35.0.0/aapt2" "$@"
EOF
chmod +x /tmp/android-tools/aapt2

cd mobile/android
./gradlew assembleDebug --no-daemon \
  -Pandroid.aapt2FromMavenOverride=/tmp/android-tools/aapt2
```

CI di x86_64 tidak butuh trik ini.

## Batasan yang masih nyata

- **Slides**: fokus verifikasi baru pada `.pptx` modern. `.ppt` legacy, `.pptm` ber-macro, `.odp`,
  dan deck terenkripsi belum diuji dan bisa ditolak.
- **PDF**: render/baca jalan, tetapi edit teks, anotasi, form filling, split/merge, OCR, dan simpan
  belum di-port.
- **Print/export**: tombol Print, Export PDF, dan Export Images masih ada di menu Slides desktop,
  tetapi pipeline native/headless-nya belum tersedia di Android dan belum menjadi target pass ini.
- **Tampilan Sheets**: nilai, formula, merge, lebar kolom, dan sheet lain dipertahankan saat save,
  tetapi font/fill/format angka dari workbook asli belum dipetakan ke tampilan Univer.
- Integrasi ExcelJS belum diuji pada workbook dengan chart/pivot visual yang rumit.
- **AI**: seluruh permukaan AI disembunyikan dan preferensinya dipaksa mati; fitur AI tidak akan
  berfungsi di Android.
- Fitur proses utama desktop lainnya: enkripsi docx, mail merge, Zotero, auto-update, dan integrasi
  sistem lain tetap di luar scope Android.
- Belum ada dialog "simpan sebelum keluar"; AutoSave aktif secara default dan tab yang sudah punya
  path disimpan otomatis. Deck baru tanpa path memakai Save/Save As untuk menentukan nama file.
- Save As memakai `window.prompt` bawaan WebView untuk nama file.
- APK masih debug-signed. Untuk distribusi, buat keystore release dan ganti `appId`/`appName` di
  `mobile/capacitor.config.json` (sekarang `com.example.genoffice`).

## Lisensi

Apache-2.0. Nama dan logo GenOffice/Genspark adalah merek dagang Mainfunc, Inc.; fork sebaiknya
memakai nama dan `appId` sendiri.

## addfont (branch addfont-picker)

Status: jalan di Docs, Sheets, Slides, Markdown (HTML tidak dipakai).
- Font disimpan di `/sdcard/Documents/fonts` (ttf/otf/woff/woff2), dimuat ulang lewat `FontFace` tiap app dibuka.
- Daftar font: Add font... > Recent (maks 5) > System > Common. Markdown: tombol "Aa" di ribbon, di samping tombol tema.
- Shim mendefinisikan `window.queryLocalFonts` dan `window.__genofficeFonts`. Perubahan di `apps/*` dan `packages/ui` digate `__genofficeAndroidShim`.
- Test: `mobile/scripts/test-addfont.mjs` (FONT=/path/font.ttf), 17 PASS di device.
- APK debug: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- SHA-256: 529b7dc7360e5bc671af7abc91754c7146747cc0dd8d110c9a0dc4948f1c8832 (kode di commit 7526ee0)
- Batasan: font tidak di-embed ke DOCX/PPTX/XLSX (hanya nama); metrik Slides heuristik; font Markdown hanya tampilan editor; file font yang ditaruh manual via Termux bisa tidak terbaca app (beda owner), gunakan Add font...


## Status 2026-10-30: context menu ZenOffice (Android)

- APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk
- SHA-256: eb9931f718c529c8631dcb02d19c17cc467074755a8ecac89faa5c848ff76333
- Branch: rename-zenoffice
- Toolbar seleksi native Android dialihkan ke menu ZenOffice lewat plugin SelectionMenu (default nonaktif, hanya aktif saat jari menyentuh editor Docs). Paste, Paste as Plain Text, Select all, Search, Share memakai clipboard/Intent native.
- Klik kanan mouse: menu sistem diblok (preventDefault) di Android. Long-press sentuh: kata terblok native lalu menu ZenOffice.
- Menu bergaya Word (ikon kiri, shortcut kanan, baris Paste Options) dan mini toolbar (font/ukuran, A+/A-, painter, komentar, B/I/U, highlight, warna font, bullet, nomor, Styles). Semua digate window.__genofficeAndroidShim; Electron tidak berubah.
- Dites di device (kamu): tap menu, paste, Select all, Search, Share, toolbar mini, klik kanan mouse, long-press kata.
- Batasan: Autofill dan item pihak ketiga (Translate) tidak ikut menu ZenOffice. Label baru (Paste Options:, Search, Select all, Share, tooltip toolbar) masih Inggris tetap, belum i18n. Kotak font membaca atribut docTextStyle secara heuristik (nama berisi font/family/ascii) dan bisa kosong di dokumen tertentu. Warna highlight dan font mengikuti warna pena ribbon, tanpa palet di menu.

## Handoff 2026-10-31: zoom smoothness (branch zoom-perf)

Sudah jalan (Docs, hanya Android, digate __genofficeAndroidShim):
- Wheel/pinch dikumpulkan: preview CSS transform di .doc-zoom, zoom di-commit sekali setelah 300 ms (App.tsx, zoomGestureRef).
- Zoom tidak lagi memicu pass paginasi seluruh dokumen (zoomRenderRef + paginatorZoomDep).
- Jangkar zoom di tengah viewport (kedua sumbu), scroll dikunci selama gesture.
- Angka (dokumen ~29k node): burst 12 notch dari 10.4 s blocked menjadi ~0.6-1.2 s; sisa ongkos = layout CSS zoom ~0.5 s per commit.

Belum / masalah terbuka:
- Halaman 1 berjarak ~110 px dari ribbon di zoom kecil (seharusnya ~26 px). Penyebab belum pasti: jalankan mobile/scripts/diag-gap.mjs.
- Efek vertikal jangkar tengah membuat dokumen meluncur jauh; perlu aturan: dekat atas dokumen -> tetap menempel atas.
- PDF (apps/pdf/src/renderer/App.tsx, wheel handler ~baris 6925, PdfPage.tsx) dan Slides BELUM dipatch. Tunggu agent PDF converter commit dulu (file yang sama). Pola yang sama: preview transform lalu satu commit (pdf.js memakai pendekatan CSS-zoom-lalu-redraw).
- Mouse/pinch sintetis: mobile/scripts/bench-burst.mjs, check-center.mjs, diag-pinchscroll.mjs, prof-trace.mjs (jalankan dengan proxy: webview-proxy.py PID 9222).
- Aturan: jangan commit di branch lain; cek `git branch --show-current` sebelum commit (ada sesi AI lain di repo yang sama).
## Status 2026-10-31: menu "+" ala WPS, tab bar

- Tombol "+" sekarang di kanan tab terakhir dan membuka popup New (Docs, Sheets, Slides, PDF, Markdown, HTML, Open local file). Tiga titik kanan dihapus, "Close other tabs" ada di menu tiga garis kiri. Tab ZenOffice selebar logo dan nama.
- Branch: main (kode di commit da4e180)
- SHA-256 APK debug: 872978488f358e1e393b493c83aaee1916a99b073f2e38059b0278512376e9e3
- Dites manual di device (kamu): popup, penempatan "+", tab ZenOffice, menu kiri.
- Batasan: commit da4e180 ditulis AI lain dan belum ada test otomatis. Kerjaan zoom-perf dan pdf-converter belum selesai dan tidak termasuk APK ini.


## Update 2026-10-31: zoom Docs + ruler (branch zoom-perf2)

- APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk
- SHA-256: a494baabb16b857073b4e0884675744e2f2fdff7791321c367486b1b6c7b86ee
- Docs (Android, digate __genofficeAndroidShim): preview CSS transform lalu satu commit setelah 300 ms; zoom tidak lagi memicu pass paginasi (zoomRenderRef); transform-origin dalam persen (CSS zoom menskalakan px); jangkar tengah viewport, scroll dikunci selama gesture.
- Ruler v3 (zen-v3-ruler): sticky, padding atas area scroll 0, ruler ikut skala halaman dengan tepi atas dipaku; di scrollTop<=1 jangkar = tepi atas dokumen.
- Terukur (roda mouse sintetis, Fiqih_Nikah 80 hal): ruler top 0 di semua posisi scroll; jarak ruler ke halaman 1 = 0 selama gesture di atas dokumen; 5 siklus in/out tanpa akumulasi geser [0,0].
- Belum: poin performa lanjutan (sisa layout CSS zoom ~0.5 s per commit), PDF dan Slides, uji jari oleh user.
- Skrip ukur: mobile/scripts/check-ruler.mjs, check-scan.mjs, diag-zoomfrac.mjs, diag-zoomdrift.mjs, bench-burst.mjs (butuh webview-proxy.py PID 9222).
- Branch ini belum di-merge ke main; menunggu persetujuan user.

## Halaman panjang (belum diperbaiki, di luar lag mengetik)
- Terlihat di One Page dan Multiple Pages pada _perf_test_80p (sekitar 12 halaman), sama saat patch gap/tab dimatikan.
- Halaman 11: footnote 62 baris membuat gap 1200 px (normal 220-350). Footnote dihitung sebagai reservasi tinggi blok (footnoteExtraPx di pagination-measure.ts), tidak dipecah antar halaman. Dugaan, belum diverifikasi terhadap Word.
- Halaman lain: paragraf bergap inline menempati 1325-2276 px antar gap; penyebab belum diketahui. topPush selalu 0, jadi bukan keepNext.

### Update halaman panjang (_perf_test_80p)
- Ukuran sahih: frame dari pageFramesFromGaps (71 frame, median 1002 px). 9 frame tinggi: 3, 10, 11, 12, 30, 53, 54, 62, 66.
- Frame panjang = isi nyata (bukan artefak grid). Memotong tinggi frame di grid akan menyembunyikan teks, jadi ditolak.
- Halaman 11: satu footnote 3938 karakter, gap 1200 px. 53/54: gap 671/373 px. Slicer (pagination-slices.ts, _placeParaBlock) membebankan footnote per baris referensi dan tidak memecahnya lintas halaman. Perbaikan = fitur baru lintas slicer, PaginationPreview, dan noteAreaPlacement.
- Halaman 3, 10, 30, 62, 66: gap normal tapi frame 1250-1700 px; penyebab belum diketahui.
- Skrip pengukuran lama perf-tall5..10 memakai gap top-level saja, tidak sahih; yang sahih: perf-frames.mjs, perf-frame12.mjs.

## Update perf: ngetik di paragraf bertab (branch perf-large-docs)

Commit 8f41a56 (class doc-tabs-measuring hanya jika perlu, saklar __zenNoTabLight) tidak berefek: 114 dari 115 paragraf bertab di _perf_test_80p.docx adalah justify.
Commit 1c2f1de: suspensi justify dipasang inline hanya di paragraf yang diukur, domObserver di-stop sementara (saklar window.__zenNoTabScoped, hanya aktif di balik __genofficeAndroidShim).
APK sha256 9517cf7399d36256d225208475f4fb8f87cbe630fb57a53717d8bad6372fb1ef (bundle docs index-BRwzzry8.js).
Terukur (ab-measuring.mjs, 3 putaran): TAB normal p50 182-212 ms menjadi 85-109 ms; style/huruf 48-51 menjadi 1-19 ms.
Belum terbukti: tab stop dan pemisah halaman tidak bergeser (cek visual belum dicatat); lonjakan latensi maks 440-570 ms masih ada, penyebab belum diketahui; layouts/huruf masih 3 (PLAIN 1); patch soft wrap-width 63f05db belum diuji A/B.

## Update perf 2 (branch perf-large-docs): ringkasan terukur
Aktif default: 63f05db (soft wrap-width, belum diuji A/B), 1c2f1de + 3f8ae09 (suspensi justify inline hanya untuk 4 miss pertama per pass).
Terukur: pass dingin 700p huruf pertama 22,8 detik (184 layout/huruf) menjadi 7 layout/huruf, maks sekitar 1,9 detik. Ngetik di paragraf bertab 80p: p50 182-212 menjadi 85-109 ms. 300p: paragraf bertab sama dengan paragraf biasa (sekitar 270-300 ms).
Steady-state 700p (7.497 node): p50 sekitar 800-870 ms; tiga plugin pengukur mati sekitar 370-420 ms. Justify-shrink sekitar 300 ms/huruf (80% di view.dispatch), tab 70-90, cjk 5. Lantai: sekitar 400-460 ms/huruf kerja native di luar script/layout/style, belum teridentifikasi.
Opt-in (window flag, hanya di balik __genofficeAndroidShim), default mati: __zenJustifyInc (selisih 0-40 ms, dalam noise), __zenDeferMeasure/__zenDeferMs (tidak konsisten, uji kebenaran belum jalan), __zenJustifySkip (SALAH: __zenJustifyMiss=12, jangan dipakai). Probe: __zenSkipTab/Justify/Cjk, __zenM, __zenMJ, __zenMC, __zenMJs.
Sudah dicoba, tidak berguna: content-visibility (layout 25 menjadi 72 ms); setProperty(--) bukan per ketukan; recalc style hanya 4 elemen per huruf; postMessage 18 ms.
Belum diuji: hipotesis React prepareForCommit (hp sekitar 28 ms; tes contentEditable belum dijalankan), windowing halaman, ukur hanya paragraf di layar (perlu uji kebenaran terhadap ukur penuh karena word-spacing mengubah pemenggalan baris dan batas halaman).
Catatan uji: A/B p50 punya drift sekitar 40 ms antar blok; percayai hanya selisih lebih besar yang konsisten. Pastikan baris FLAG OK sebelum A/B.

## Update perf 3 (branch perf-large-docs): jalur buka 700p
Alat ukur: mobile/scripts/test-open-profile.mjs [local] (buka _perf_test_700p.docx, linimasa overlay/respons + profil CPU). APK terpasang SHA-256 7247ea644153fe93aefc97bcb859232211e5a612162c4f7bc3d00abf91176154 (commit 9aface0).
Terukur sebelum: overlay 66 detik (paginasi: mr/ov + getBoundingClientRect), lalu editor tidak merespons 113+10+7 detik sampai detik ke-224. Penyebab utama: EditorView.domAtPos O(dokumen) (4 us di blok 2% sampai 196 us di blok 98%), dua kali per kata di justify-shrink; measureImpl justify 107 detik inklusif (74 detik di domAtPos).
Sesudah (flag __zenLocalDom + __zenLocalDomVerify, opt-in, mati): macet 39+8 detik, editor bisa dipakai sekitar detik ke-122, justify 35 detik inklusif. Verifikasi 35.728 pemeriksaan, 0 selisih. Satu kali jalan per kondisi, perlu diulang.
Opt-in terbukti lain: __zenDecoInc (justify), __zenTabDecoInc (tab): mengetik 700p sibuk 800-870 jadi 480-590 ms/huruf; uji Enter/Shift+Enter/Backspace/undo/redo selisih 0.
Belum: flag jadi default, uji regresi 300p/80p, overlay menunggu pass pertama justify (sekarang dilepas sekitar 50 detik sebelum editor bisa dipakai), paginasi 55 detik, cjk dan tab masih memakai domAtPos (cjk-punct-shrink.ts:708, decoration-extensions.ts:434), listNumbering needsRecompute 12/12 di paragraf bertab (penyebab belum ketemu), kesibukan latar sekitar 23% saat diam, dugaan postMessage sekitar 367/detik saat editor fokus (belum terbukti), hasil test-task-sources tidak valid (kategori trace terlalu berat).
Cleanup belum dijalankan (tab uji, file _perf_test_700p*.docx, proxy).
## slides-touch-drag (Android)
- Objek slide hanya bisa dipindah setelah tekan lama (~400 ms) lalu geser; tap/geser biasa hanya memilih. Gate: `__genofficeAndroidShim` + `pointer: coarse`. Kode: `SlideCanvas.tsx` (`holdToDrag`, `beginHold`).
- Commit 326ab51. APK SHA-256: cac44097c168322a48030150357a86a86ae14fe1291327e07c3cd422e0ff5696
- Bundle slides SHA-256: 208c3b9bff3f3f56d1ff5547a24c4fe14325784c673136ae8abe44ff35f780cd
- Status: dites manual di device oleh user, sesuai ekspektasi. Tidak ada test CDP otomatis.

## Status docs open fix (2026-11-04, branch fix-docs-blank-open)
- Penyebab editor kosong saat buka .docx: rewrite layout/chunking apps/docs (commit c87cff7, 2001cd7, state unknown). apps/docs dikembalikan ke 4387fbb (d5d6565); rewrite masih ada di history.
- Terverifikasi di device: _perf_test_80p (16.405 kata) terbuka utuh, 807 child ProseMirror, tinggi 77.727 px, 73 header halaman, tanpa PAGEERROR/dialog.
- APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk, SHA-256 9ce7c97359fb98cac56b944f5abcdfb96491885da657821a78a1f803c2314860 (bundle docs index-D-KX2wG7.js 1e56a7bb50ef39b81dd1bfb33527e1a0239638ca9a3fbadf4aa2ae0500e0eeda)
- Batas: chunking tidak aktif lagi (dokumen besar bisa lebih lambat dibuka/scroll); belum diuji: edit, simpan lalu buka ulang, dokumen kecil/lain, smoke test final.

## Status docs open fix (2026-11-04, branch fix-docs-blank-open)
- Penyebab editor kosong saat buka .docx: rewrite layout/chunking apps/docs (commit c87cff7, 2001cd7, state unknown). apps/docs dikembalikan ke 4387fbb (d5d6565); rewrite masih ada di history.
- Terverifikasi di device: _perf_test_80p (16.405 kata) terbuka utuh, 807 child ProseMirror, tinggi 77.727 px, 73 header halaman, tanpa PAGEERROR/dialog.
- APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk, SHA-256 9ce7c97359fb98cac56b944f5abcdfb96491885da657821a78a1f803c2314860 (bundle docs index-D-KX2wG7.js 1e56a7bb50ef39b81dd1bfb33527e1a0239638ca9a3fbadf4aa2ae0500e0eeda)
- Batas: chunking tidak aktif lagi (dokumen besar bisa lebih lambat dibuka/scroll); belum diuji: edit, simpan lalu buka ulang, dokumen kecil/lain, smoke test final.

## Lag ketik dokumen besar (2026-11-05, branch fix-docs-blank-open)
- Penyebab terukur: VerticalRuler menggambar tick untuk seluruh tinggi dokumen (52 ribu line dan 52 ribu g, total sekitar 114 ribu node SVG) dan React mendiff semuanya di tiap forceRender. Commit 9060143 membatasi tick dan zona ke rentang terlihat (hanya Android, tinggi lebih dari 20000 px). Node anak langsung svg turun 52075 ke 394.
- Debounce render 120 ms (70aa367) tidak membantu pada kecepatan ketik biasa, sudah di-revert (fce732c).
- _perf_test_700p (2).docx (612 halaman, 7106 paragraf), satu tombol tiap 200 ms: panah keydown median 344 ke 160 ms, keyup 232 ke 152 ms; mengetik keydown median 336 ke 328 ms (lonjakan 1224 ms). Run ini tersentuh layar, angka mengetik belum bersih.
- Dokumen 81 halaman: sekitar 78 ms per ketikan.
- APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk, SHA-256 e55a2051a2d314504fa4cddc74648c46fbd44ea4be5f5908c76083cc5d432cb4, bundle docs index-c0ZOCI6F.js 91fa6431b6568859ac80ee0b54a80c8f156f28e12a02dd28c3b5cccecc94d147.
- Belum: sumber sisa lag mengetik, waktu beku setelah file besar dibuka (11 sampai 110 detik, bervariasi), smoke test final.
