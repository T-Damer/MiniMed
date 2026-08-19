import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { get } from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const require = createRequire(import.meta.url);

const releaseProxy = {
  target: 'https://github.com',
  changeOrigin: true,
  followRedirects: true,
  rewrite: (path: string) =>
    path.replace(/^\/content\/releases\//u, '/T-Damer/MiniMed/releases/download/'),
};

const LARGE_COMPANION_MIN_BYTES = 32 * 1024 * 1024;
const LARGE_COMPANION_PATHS = [
  'content/medications.db',
  'content/mkb.db',
  'content/ambulatory.db',
] as const;

const TESSDATA_LANGS = ['eng', 'rus'] as const;
const TESSDATA_VERSION = '4.0.0';
const TESSDATA_BASE = `https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/${TESSDATA_VERSION}/`;
const PDFJS_STATIC_DIRECTORIES = ['wasm', 'standard_fonts', 'cmaps', 'iccs'] as const;

function downloadFile(url: string, destination: string): Promise<void> {
  if (existsSync(destination)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const redirect = response.headers.location;
        if (!redirect) {
          reject(new Error(`Redirect without location for ${url}`));
          return;
        }
        downloadFile(redirect, destination).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode ?? 'unknown'}`));
        return;
      }
      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

function ensureTessdataAssets(): Plugin {
  const tessdataDir = fileURLToPath(new URL('./public/tessdata', import.meta.url));
  return {
    name: 'ensure-tessdata-assets',
    async buildStart() {
      mkdirSync(tessdataDir, { recursive: true });
      await Promise.all(
        TESSDATA_LANGS.map((lang) =>
          downloadFile(
            `${TESSDATA_BASE}${lang}.traineddata.gz`,
            join(tessdataDir, `${lang}.traineddata.gz`),
          ),
        ),
      );
    },
  };
}

function copyDirectoryFiles(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(targetDir, name));
  }
}

function ensurePdfJsAssets(): Plugin {
  const pdfBuildFile = require.resolve('pdfjs-dist/build/pdf.mjs');
  const pdfRoot = join(dirname(pdfBuildFile), '..');
  const publicPdfRoot = fileURLToPath(new URL('./public/pdfjs', import.meta.url));
  return {
    name: 'ensure-pdfjs-assets',
    buildStart() {
      for (const directory of PDFJS_STATIC_DIRECTORIES) {
        const sourceDir = join(pdfRoot, directory);
        if (!existsSync(sourceDir)) continue;
        copyDirectoryFiles(sourceDir, join(publicPdfRoot, directory));
      }
    },
  };
}

function excludeOptionalPublicAssets(): Plugin {
  let outDir = 'dist';

  return {
    name: 'exclude-optional-public-assets',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const packageLarge = process.env['VITE_PACKAGE_LARGE_COMPANIONS'] === 'true';
      const inCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
      if (packageLarge || !inCi) return;
      for (const relativePath of LARGE_COMPANION_PATHS) {
        const absolutePath = join(outDir, relativePath);
        if (!existsSync(absolutePath)) continue;
        if (statSync(absolutePath).size < LARGE_COMPANION_MIN_BYTES) continue;
        rmSync(absolutePath, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [solid(), ensureTessdataAssets(), ensurePdfJsAssets(), excludeOptionalPublicAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/content/releases': releaseProxy,
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/content/releases': releaseProxy,
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
