import { Code2, Layers, MailCheck, Sparkles } from 'lucide-react'

import { Maily } from '@/components/Maily'

// Decorative side of the sign-in page: Maily, a miniature of the editor
// (blocks on the left, the matching code on the right) and floating chips for
// the main features. Purely visual, hidden from assistive technology.

function Line({ children }: { children: React.ReactNode }) {
  return <div className="whitespace-nowrap">{children}</div>
}

export function AuthIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl select-none">
      <div className="absolute -inset-10 rounded-full bg-violet/20 blur-3xl" />
      <div className="absolute -right-6 -top-8 size-40 rounded-full bg-pink/15 blur-3xl" />

      {/* Miniature editor */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-night/90 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-pink/80" />
          <span className="size-2.5 rounded-full bg-[#ffd479]/80" />
          <span className="size-2.5 rounded-full bg-cyan/80" />
          <span className="ml-3 font-mono text-[10px] text-mute">newsletter.html</span>
        </div>

        <div className="grid grid-cols-[1fr_1.15fr]">
          {/* Visual side */}
          <div className="space-y-2.5 bg-[#f2f2f7] p-4">
            <div className="rounded bg-white p-3 shadow-sm">
              <div className="h-2.5 w-3/4 rounded-sm bg-[#0f0f1a]" />
              <div className="mt-2 h-1.5 w-full rounded-sm bg-[#c8c8dc]" />
              <div className="mt-1 h-1.5 w-5/6 rounded-sm bg-[#c8c8dc]" />
              <div className="mt-3 h-6 w-20 rounded bg-pink" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded bg-white p-2 shadow-sm">
                <div className="aspect-[4/3] rounded-sm bg-gradient-to-br from-cyan/50 to-violet/60" />
                <div className="mt-1.5 h-1.5 w-2/3 rounded-sm bg-[#c8c8dc]" />
              </div>
              <div className="rounded bg-white p-2 shadow-sm">
                <div className="aspect-[4/3] rounded-sm bg-gradient-to-br from-pink/50 to-[#ffd479]/70" />
                <div className="mt-1.5 h-1.5 w-1/2 rounded-sm bg-[#c8c8dc]" />
              </div>
            </div>
          </div>

          {/* Code side */}
          <div className="overflow-hidden bg-void p-4 font-mono text-[10.5px] leading-[1.7]">
            <Line>
              <span className="hl-tag">&lt;div</span> <span className="hl-attr">data-neon</span>=<span className="hl-neon">"section"</span>
              <span className="hl-tag">&gt;</span>
            </Line>
            <Line>
              {'  '}
              <span className="hl-tag">&lt;h2</span> <span className="hl-attr">data-neon</span>=<span className="hl-neon">"heading"</span>
              <span className="hl-tag">&gt;</span>
            </Line>
            <Line>
              {'    '}
              <span className="hl-hubl">{'{{ module.titre }}'}</span>
            </Line>
            <Line>
              {'  '}
              <span className="hl-tag">&lt;/h2&gt;</span>
            </Line>
            <Line>
              {'  '}
              <span className="hl-hubl">{'{% if module.promo %}'}</span>
            </Line>
            <Line>
              {'    '}
              <span className="hl-tag">&lt;a</span> <span className="hl-attr">href</span>=<span className="hl-val">"…"</span>
              <span className="hl-tag">&gt;</span>
            </Line>
            <Line>
              {'  '}
              <span className="hl-hubl">{'{% endif %}'}</span>
            </Line>
            <Line>
              <span className="hl-tag">&lt;/div&gt;</span>
            </Line>
          </div>
        </div>
      </div>

      {/* Maily */}
      <div className="absolute -bottom-14 -left-2 sm:-left-8">
        <div className="relative">
          <div className="absolute inset-2 rounded-full bg-cyan/20 blur-2xl" />
          <Maily size={120} mood="happy" />
        </div>
      </div>

      {/* Floating chips */}
      <div className="auth-float absolute -right-3 top-14 inline-flex items-center gap-1.5 rounded-full border border-cyan/40 bg-night/95 px-3 py-1.5 text-xs text-white shadow-lg sm:-right-8">
        <Code2 className="size-3.5 text-cyan" /> Code ↔ visuel
      </div>
      <div className="auth-float-2 absolute -right-2 bottom-6 inline-flex items-center gap-1.5 rounded-full border border-pink/40 bg-night/95 px-3 py-1.5 text-xs text-white shadow-lg sm:-right-6">
        <MailCheck className="size-3.5 text-pink" /> Test multi-clients
      </div>
      <div className="auth-float-3 absolute -left-3 top-24 hidden items-center gap-1.5 rounded-full border border-violet/50 bg-night/95 px-3 py-1.5 text-xs text-white shadow-lg sm:inline-flex sm:-left-8">
        <Layers className="size-3.5 text-violet" /> Cards imbriquées
      </div>
      <div className="auth-float-2 absolute -bottom-12 left-32 hidden items-center gap-1.5 rounded-full border border-line bg-night/95 px-3 py-1.5 text-xs text-white shadow-lg sm:inline-flex">
        <Sparkles className="size-3.5 text-[#ffd479]" /> Maily, ton IA
      </div>
    </div>
  )
}
