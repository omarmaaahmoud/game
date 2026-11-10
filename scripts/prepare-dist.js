import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const manifestPath = path.join(publicDir, 'build', 'manifest.json');

// 1. Ensure dist directory exists
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Read manifest
if (!fs.existsSync(manifestPath)) {
  console.error('Manifest not found at:', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const jsEntry = manifest['resources/js/app.jsx']?.file;
const cssEntry = manifest['resources/css/app.css']?.file || (manifest['resources/js/app.jsx']?.css && manifest['resources/js/app.jsx'].css[0]);

if (!jsEntry) {
  console.error('JS entry not found in manifest');
  process.exit(1);
}

// 3. Copy public/build to dist/build AND dist/assets
const buildDir = path.join(publicDir, 'build');
if (fs.existsSync(buildDir)) {
  fs.cpSync(buildDir, path.join(distDir, 'build'), { recursive: true });
}
const assetsDir = path.join(publicDir, 'build', 'assets');
if (fs.existsSync(assetsDir)) {
  fs.cpSync(assetsDir, path.join(distDir, 'assets'), { recursive: true });
}

// 4. Copy public/models to dist/models
const modelsDir = path.join(publicDir, 'models');
if (fs.existsSync(modelsDir)) {
  fs.cpSync(modelsDir, path.join(distDir, 'models'), { recursive: true });
}

// 4b. Copy public/intro-frames and intro-frames-desktop to dist
const introFramesDir = path.join(publicDir, 'intro-frames');
if (fs.existsSync(introFramesDir)) {
  fs.cpSync(introFramesDir, path.join(distDir, 'intro-frames'), { recursive: true });
}
const introFramesDeskDir = path.join(publicDir, 'intro-frames-desktop');
if (fs.existsSync(introFramesDeskDir)) {
  fs.cpSync(introFramesDeskDir, path.join(distDir, 'intro-frames-desktop'), { recursive: true });
}

// 5. Copy any other public static files (ignoring build & index.php)
fs.readdirSync(publicDir).forEach((item) => {
  if (item !== 'build' && item !== 'index.php' && item !== 'models') {
    const src = path.join(publicDir, item);
    const dest = path.join(distDir, item);
    if (!fs.existsSync(dest)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
});

// 6. Generate dist/index.html
const indexHtmlContent = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#090514">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Tecorbia">
    <title>Tecorbia Kids Arena 🚀</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Fredoka:wght@600;700;800&family=Nunito:wght@700;800;900&family=IBM+Plex+Sans+Arabic:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    ${cssEntry ? `<link rel="stylesheet" href="/build/${cssEntry}">` : ''}
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/build/${jsEntry}"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(distDir, 'index.html'), indexHtmlContent, 'utf-8');
console.log('✓ Successfully prepared dist/ for Vercel deployment with index.html, assets, and 3D models.');

