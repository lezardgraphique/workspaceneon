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

// Safari before 16.4 (older iPhones and iPads) rejects a whole file holding a
// regular expression with a lookbehind ((?<= or (?<!): "Invalid regular
// expression: invalid group specifier name", and the editor doesn't open.
// - remark-gfm's e-mail autolinks use one; its callback already checks the
//   previous character, so the lookbehind can go.
// - Any other one in the client build fails the build (feature-tested strings
//   of `marked` excepted).
const SAFARI_LOOKBEHIND_FIXES: [RegExp, string, string][] = [
  [/mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/, '/(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@', '/([-.\\w+]+)@'],
]
const SAFE_LOOKBEHIND = ['`(?<=1)(?<!1)`', '"(?<!`)()"']
function safariRegex(): Plugin {
  return {
    name: 'safari-regex',
    enforce: 'pre',
    transform(code, id) {
      for (const [file, from, to] of SAFARI_LOOKBEHIND_FIXES) {
        if (!file.test(id)) continue
        if (!code.includes(from)) this.error(`safari-regex: pattern not found in ${id} (dependency updated?)`)
        return code.replace(from, to)
      }
    },
    generateBundle(_, bundle) {
      if (this.environment?.name !== 'client') return
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue
        let code = chunk.code
        for (const s of SAFE_LOOKBEHIND) code = code.split(s).join('')
        const at = code.search(/\(\?<[=!]/)
        if (at >= 0) this.error(`safari-regex: lookbehind in ${name} (breaks Safari < 16.4): …${code.slice(at - 60, at + 40)}…`)
      }
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    safariRegex(),
    tailwindcss(),
    netlify(),
    tanstackStart(),
    viteReact(),
    assetManifest(),
  ],
})

export default config
