/*
 * Applies the Android-specific shell tweaks after `npx cap add/sync android`.
 *
 * Capacitor generates the native project, so this script is intentionally
 * idempotent and must run again after every sync. It
 *   - enables immersive/edge-to-edge display (no status bar, transient nav),
 *   - lets the WebView draw under the display cutout while Capacitor keeps the
 *     content out of the unsafe area,
 *   - points the splash screen at the regular no-action-bar theme.
 *
 * Run: node mobile/scripts/patch-android.mjs
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobileDir = resolve(here, '..')
const androidDir = join(mobileDir, 'android')
const javaPath = join(
  androidDir,
  'app/src/main/java/com/example/genoffice/MainActivity.java',
)
const stylesPath = join(androidDir, 'app/src/main/res/values/styles.xml')

if (!existsSync(join(androidDir, 'app'))) {
  console.error('Android project not found. Run `npx cap add android` first.')
  process.exit(1)
}

const mainActivity = `package com.example.genoffice;

import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ActionMode;
import android.view.Window;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;

import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Fullscreen, edge-to-edge host for the GenOffice shell.
 *
 * The status bar is hidden and navigation bars use transient swipe-to-reveal
 * behavior, so the desktop-style tab strip can use the full display. Capacitor
 * still applies display-cutout margins to the WebView, which keeps controls
 * away from notches and rounded corners.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PdfExportPlugin.class);
        registerPlugin(SelectionMenuPlugin.class);
        registerPlugin(OpenIntentPlugin.class);
        super.onCreate(savedInstanceState);
        applyEdgeToEdge(getWindow());
        hideSystemBars();
        zenInstallBack();
        if (savedInstanceState == null) OpenIntentPlugin.enqueue(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        OpenIntentPlugin.enqueue(this, intent);
    }

    /** Toolbar seleksi native dialihkan ke menu ZenOffice (hanya saat plugin diaktifkan JS). */
    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback, int type) {
        SelectionMenuPlugin p = SelectionMenuPlugin.instance;
        if (type == ActionMode.TYPE_FLOATING && p != null && p.isEnabled()) {
            ActionMode m = p.startMode(callback);
            if (m != null) return m;
        }
        return super.onWindowStartingActionMode(callback, type);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    // zenBack: Back dikirim ke JS dulu (keluar slideshow, dst); kalau tidak dikonsumsi, perilaku default
    private void zenInstallBack() {
        final OnBackPressedCallback zenCb = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final OnBackPressedCallback self = this;
                WebView zenWv = getBridge() != null ? getBridge().getWebView() : null;
                if (zenWv == null) {
                    self.setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    self.setEnabled(true);
                    return;
                }
                zenWv.evaluateJavascript("(function(){try{return window.__zenBack&&window.__zenBack()?'1':'0'}catch(e){return '0'}})()", zenVal -> {
                    if (zenVal != null && zenVal.contains("1")) return;
                    self.setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    self.setEnabled(true);
                });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, zenCb);
    }

    private void applyEdgeToEdge(Window window) {
        WindowCompat.setDecorFitsSystemWindows(window, false);
        // zenIme: sempitkan konten saat keyboard muncul (decorFits=false tidak resize sendiri)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (zenV, zenInsets) -> {
            int zenIme = zenInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            zenV.setPadding(0, 0, 0, zenIme);
            return zenInsets;
        });
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }
    }

    private void hideSystemBars() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
`

writeFileSync(javaPath, mainActivity)

// Native PDF export plugin (offscreen WebView -> PDF, no system print dialog).
const nativeDir = join(mobileDir, 'native')
const javaRoot = join(androidDir, 'app/src/main/java')
for (const [name, target] of [
  ['PdfExportPlugin.java', join(javaRoot, 'com/example/genoffice/PdfExportPlugin.java')],
  ['PdfPrintHelper.java', join(javaRoot, 'android/print/PdfPrintHelper.java')],
  ['SelectionMenuPlugin.java', join(javaRoot, 'com/example/genoffice/SelectionMenuPlugin.java')],
  ['OpenIntentPlugin.java', join(javaRoot, 'com/example/genoffice/OpenIntentPlugin.java')],
]) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(nativeDir, name), target)
}

// Launcher icons (adaptive + legacy + monochrome).
cpSync(join(nativeDir, 'res'), join(androidDir, 'app/src/main/res'), { recursive: true, force: true })

// Point the application at the launcher icons (the generated manifest may lack them).
const manifestPath = join(androidDir, 'app/src/main/AndroidManifest.xml')
let manifest = readFileSync(manifestPath, 'utf8')
const iconAttrs = []
if (!manifest.includes('android:icon=')) iconAttrs.push('android:icon="@mipmap/ic_launcher"')
if (!manifest.includes('android:roundIcon=')) iconAttrs.push('android:roundIcon="@mipmap/ic_launcher_round"')
if (iconAttrs.length > 0) {
  manifest = manifest.replace('<application', '<application\n        ' + iconAttrs.join('\n        '))
  writeFileSync(manifestPath, manifest)
}

// Launch theme: dark window + ZenOffice splash icon (res/values*/zen_launch.xml come from native/res).
{
  let m = readFileSync(manifestPath, 'utf8')
  const next = m.replace(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>/, (tag) =>
    /android:theme="[^"]*"/.test(tag)
      ? tag.replace(/android:theme="[^"]*"/, 'android:theme="@style/ZenLaunch"')
      : tag.replace('<activity', '<activity\n            android:theme="@style/ZenLaunch"'),
  )
  if (!next.includes('android:theme="@style/ZenLaunch"')) throw new Error('manifest: MainActivity activity tag not found')
  if (next !== m) writeFileSync(manifestPath, next)
}

let styles = readFileSync(stylesPath, 'utf8')
const themeItems = `
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>`

if (!styles.includes('android:windowLayoutInDisplayCutoutMode')) {
  styles = styles.replace(
    /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
    `$1${themeItems}`,
  )
}

if (!styles.includes('name="postSplashScreenTheme"')) {
  styles = styles.replace(
    /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/,
    '$1\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>',
  )
}

writeFileSync(stylesPath, styles)

console.log('Android immersive display patch applied.')

// FileProvider untuk membagikan file dari cache/share (idempotent).
{
  let m = readFileSync(manifestPath, 'utf8')
  if (!m.includes('zenfileprovider')) {
    const provider =
      '    <!-- zenfileprovider -->\n' +
      '    <provider\n' +
      '        android:name="androidx.core.content.FileProvider"\n' +
      '        android:authorities="${applicationId}.zenfileprovider"\n' +
      '        android:exported="false"\n' +
      '        android:grantUriPermissions="true">\n' +
      '        <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/zen_file_paths" />\n' +
      '    </provider>\n    '
    if (m.split('</application>').length !== 2) throw new Error('manifest: expected exactly one </application>')
    m = m.replace('</application>', provider + '</application>')
    writeFileSync(manifestPath, m)
    console.log('FileProvider added.')
  }
}

// "Open with": ACTION_VIEW filters so file managers list ZenOffice (idempotent).
{
  let m = readFileSync(manifestPath, 'utf8')
  if (!m.includes('genoffice-open-with')) {
    const mimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/markdown',
      'text/x-markdown',
      'text/html',
    ]
    const filter =
      '    <!-- genoffice-open-with -->\n' +
      '            <intent-filter>\n' +
      '                <action android:name="android.intent.action.VIEW" />\n' +
      '                <category android:name="android.intent.category.DEFAULT" />\n' +
      mimes.map((t) => '                <data android:mimeType="' + t + '" />\n').join('') +
      '            </intent-filter>\n        '
    if (m.split('</activity>').length !== 2) throw new Error('manifest: expected exactly one </activity>')
    m = m.replace('</activity>', filter + '</activity>')
    writeFileSync(manifestPath, m)
    console.log('Open-with intent filters added.')
  }
}

// All-files access so Documents/ZenOffice lists files other apps put there (idempotent).
{
  let m = readFileSync(manifestPath, 'utf8')
  if (!m.includes('MANAGE_EXTERNAL_STORAGE')) {
    const re = /(<uses-permission android:name="android.permission.INTERNET"\s*\/>)/
    if (!re.test(m)) throw new Error('manifest: INTERNET permission line not found')
    m = m.replace(re, '$1\n    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />')
    writeFileSync(manifestPath, m)
    console.log('All-files-access permission added.')
  }
}

// ZenOffice release build: signing, version, namespace pin and default splash.
// Idempotent, so a clean `npx cap add android` still builds the same app.
{
  const gradlePath = join(androidDir, 'app/build.gradle')
  const orig = readFileSync(gradlePath, 'utf8')
  let g = orig
  if (!g.includes('ksProps')) {
    g = g.replace(
      "apply plugin: 'com.android.application'\n",
      "apply plugin: 'com.android.application'\n\n" +
        'def ksProps = new Properties()\n' +
        'def ksPath = System.getenv("ZENOFFICE_KEYSTORE_PROPS") ?: (System.getProperty("user.home") + "/keys/keystore.properties")\n' +
        'def ksFile = new File(ksPath)\n' +
        'if (ksFile.exists()) ksProps.load(new FileInputStream(ksFile))\n',
    )
  }
  if (!g.includes('signingConfigs')) {
    const old = '    buildTypes {\n        release {\n'
    if (!g.includes(old)) throw new Error('build.gradle: release buildType not found')
    g = g.replace(
      old,
      '    signingConfigs {\n' +
        '        release {\n' +
        "            if (ksProps['storeFile']) {\n" +
        "                storeFile file(ksProps['storeFile'])\n" +
        "                storePassword ksProps['storePassword']\n" +
        "                keyAlias ksProps['keyAlias']\n" +
        "                keyPassword ksProps['keyPassword']\n" +
        '            }\n' +
        '        }\n' +
        '    }\n' +
        old +
        '            signingConfig signingConfigs.release\n',
    )
  }
  g = g.replace(/namespace\s+"[^"]*"/, 'namespace "com.example.genoffice"')
  g = g.replace(/versionName\s+"[^"]*"/, 'versionName "0.1.0-beta"')
  if (g !== orig) {
    writeFileSync(gradlePath, g)
    console.log('Release signing, namespace and version applied to build.gradle.')
  }
  const resDir = join(androidDir, 'app/src/main/res')
  const splashSrc = join(resDir, 'drawable-port-xxhdpi/splash.png')
  const splashDst = join(resDir, 'drawable/splash.png')
  if (existsSync(splashSrc) && !existsSync(splashDst)) {
    mkdirSync(dirname(splashDst), { recursive: true })
    copyFileSync(splashSrc, splashDst)
    console.log('Default splash drawable added.')
  }
}
