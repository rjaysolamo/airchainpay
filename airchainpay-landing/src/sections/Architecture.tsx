import { useState } from 'react'
import { ARCHITECTURE } from '../data/content'
import { IconCheck, IconLayers } from '../components/icons'

export default function Architecture() {
  const [active, setActive] = useState(ARCHITECTURE[0].id)

  return (
    <section id="architecture" className="relative py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-purple/5 blur-3xl" />
      </div>

      <div className="container-x">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="section-eyebrow">
            <IconLayers className="h-3.5 w-3.5" />
            System Architecture
          </span>
          <h2 className="mt-5 text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
            A <span className="text-gradient">four-tier system</span> built for trustless
            offline payments
          </h2>
          <p className="mt-4 text-pretty text-slate-400">
            Every layer is purpose-built — from the React Native wallet in your pocket to the
            Solidity contracts that settle on-chain.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          {/* Interactive stack selector */}
          <div className="reveal space-y-3">
            {ARCHITECTURE.map((tier) => {
              const isActive = active === tier.id
              const Icon = tier.icon
              return (
                <button
                  key={tier.id}
                  type="button"
                  onMouseEnter={() => setActive(tier.id)}
                  onFocus={() => setActive(tier.id)}
                  onClick={() => setActive(tier.id)}
                  className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border p-4 text-left transition-all duration-300 ${
                    isActive
                      ? 'border-white/20 bg-white/[0.06] shadow-glow-soft'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
                  }`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${tier.accent} transition-opacity duration-300 ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tier.accent} text-white transition-transform duration-300 group-hover:scale-105`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{tier.index}</span>
                      <span className="truncate font-semibold text-white">{tier.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-brand-cyan">
                      {tier.stack}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Detail panel */}
          <div className="reveal lg:sticky lg:top-24" style={{ transitionDelay: '120ms' }}>
            {ARCHITECTURE.map((tier) => {
              if (tier.id !== active) return null
              const Icon = tier.icon
              return (
                <div
                  key={tier.id}
                  className="glass relative overflow-hidden rounded-3xl p-8 animate-fade-up"
                >
                  <div
                    className={`pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br ${tier.accent} opacity-20 blur-3xl`}
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br ${tier.accent} text-white ${tier.glow}`}
                    >
                      <Icon className="h-8 w-8" />
                    </span>
                    <span className="font-mono text-5xl font-bold text-white/5">
                      {tier.index}
                    </span>
                  </div>

                  <h3 className="mt-6 text-2xl font-semibold text-white">{tier.title}</h3>
                  <p
                    className={`mt-1 inline-block bg-gradient-to-r ${tier.accent} bg-clip-text font-mono text-sm text-transparent`}
                  >
                    {tier.stack}
                  </p>
                  <p className="mt-4 leading-relaxed text-slate-400">{tier.summary}</p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {tier.points.map((p) => (
                      <div
                        key={p}
                        className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200"
                      >
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-cyan/15 text-brand-cyan">
                          <IconCheck className="h-3.5 w-3.5" />
                        </span>
                        {p}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
