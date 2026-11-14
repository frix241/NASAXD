import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "astrotwin-offline",
      generateBundle(_options, bundle) {
        const assets = [
          "/",
          "/index.html",
          "/favicon.svg",
          ...Object.keys(bundle).map((k) => "/" + k),
          "/models/astrotwin_human.glb",
          "/models/draco/draco_decoder.wasm",
          "/models/draco/draco_wasm_wrapper.js",
        ];
        const version = "astrotwin-" + Date.now();
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE=${JSON.stringify(version)};const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('astrotwin-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.match(e.request,{ignoreVary:true,ignoreSearch:e.request.mode==='navigate'}).then(hit=>hit||fetch(e.request)));});`,
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
