# ZenOffice

Offline office suite for Android: Docs, Sheets, Slides, PDF, Markdown and HTML,
with Word, Excel, PowerPoint and PDF files saved back in their real formats.

**Status: beta (0.1.0-beta).** Expect rough edges, especially with very large documents.

ZenOffice is an independent Android port of
[GenOffice](https://github.com/genspark-ai/genoffice) (Apache-2.0). It is not
affiliated with or endorsed by Mainfunc, Inc. or Genspark. See [NOTICE](NOTICE).

## Differences from upstream

- Android app built with Capacitor (mobile/), package com.minhaj.zenoffice.
- Documents live in Documents/ZenOffice. The app asks for "All files access"
  so it can list documents that other apps or your file manager put there.
  Files stay on your device.
- The AI panel is disabled in this build, and the desktop shell (including its
  analytics) is not part of it.
- Native helpers for opening files from other apps, Save as PDF and printing.

## Build from source

Requires Node (see .nvmrc), JDK 21 and the Android SDK (platform 35).

    npm ci --ignore-scripts
    node mobile/scripts/build-web.mjs
    cd mobile && npm ci
    npx cap add android && npx cap sync android
    node scripts/patch-android.mjs
    cd android && ./gradlew assembleDebug

Release signing reads ~/keys/keystore.properties, or the path in
ZENOFFICE_KEYSTORE_PROPS. Without it only debug builds are produced.

## Support

If ZenOffice is useful to you: https://saweria.co/zenoffice

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
