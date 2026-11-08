import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// geotiff ships LERC and Zstandard decoders as WebAssembly (several hundred kB). Both
// compressions are rare outside GIS, so they are replaced by a stub that reports them.
const STUBBED = /geotiff[\/]dist-module[\/]compression[\/](lerc|zstd)\.js$/;
const stubRareTiffDecoders = {
  name: "stub-rare-tiff-decoders",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer || !/geotiff/.test(importer) || !/(lerc|zstd)\.js$/.test(source)) return null;
    const r = await this.resolve(source, importer, { ...options, skipSelf: true });
    return r && STUBBED.test(r.id) ? "\0tiff-stub:" + (/lerc/.test(source) ? "LERC" : "Zstandard") : null;
  },
  load(id) {
    if (!id.startsWith("\0tiff-stub:")) return null;
    const name = id.split(":")[1];
    return `export default class { constructor() { throw new Error("TIFF files compressed with ${name} aren't supported. Save the image with LZW, Deflate or no compression."); } }`;
  }
};

// A single index.html with JS and CSS inlined: runs on GitHub Pages,
// as a claude.ai artifact and straight from disk (file://).
// The decoding worker is inlined too, with geotiff's lazily loaded decoders bundled into it.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  worker: { format: "es", plugins: () => [stubRareTiffDecoders], rollupOptions: { output: { inlineDynamicImports: true } } },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["test/**/*.test.js"], testTimeout: 30000 }
});
