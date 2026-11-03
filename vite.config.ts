import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

// Lists the client build files so the service worker can store the whole app
// (lazy chunks included) at install and run it without a connection.
function assetManifest(): Plugin {
  return {
    name: 'asset-manifest',
    apply: 'build',
    generateBundle(_, bundle) {
      if (this.environment?.name !== 'client') return
      const files = Object.keys(bundle)
        .filter((f) => /\.(js|css|woff2?)$/.test(f))
        .map((f) => '/' + f)
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) })
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    netlify(),
    tanstackStart(),
    viteReact(),
    assetManifest(),
  ],
})

export default config
