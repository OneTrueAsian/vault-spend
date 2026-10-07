import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mobileOfflineBuild } from "./tools/mobile-offline-build";

export default defineConfig(({mode})=>{
  const entry=mode==="preview"?"mobile/preview.html":mode==="offline-test"?"mobile/storage-test.html":"mobile/index.html";
  return {
  plugins:[react(),{
    name:"browser-only-boundary",
    generateBundle(_options,bundle) {
      for(const chunk of Object.values(bundle)) if(chunk.type==="chunk") for(const id of Object.keys(chunk.modules)) {
        const normalized=id.replace(/\\/g,"/");
        if(normalized.includes("/@tauri-apps/") || (mode!=="preview" && (normalized.includes("/tests/fixtures/") || normalized.endsWith("/mobilePreviewFixtures.ts"))) || (mode!=="offline-test"&&normalized.endsWith("/mobileStorageProbe.tsx"))) this.error(`Forbidden mobile dependency: ${normalized}`);
      }
    },
  },...(mode==="preview"?[]:[mobileOfflineBuild(entry)])],
  base:"./",
  // No desktop public files: this entry ships only its own bundled assets and local fonts.
  publicDir:false,
  build:{outDir:mode==="preview"?"dist-mobile-preview":mode==="offline-test"?"dist-mobile-test":"dist-mobile",emptyOutDir:true,rollupOptions:{input:entry}},
  server:{host:"127.0.0.1",port:1425,strictPort:true},
  preview:{host:"127.0.0.1",port:1425,strictPort:true},
};});
