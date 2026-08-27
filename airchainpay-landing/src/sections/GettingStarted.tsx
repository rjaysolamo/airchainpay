import { useEffect, useState } from 'react'
import { SETUP_TABS } from '../data/content'
import { IconCheck, IconCopy, IconRocket, IconArrowRight } from '../components/icons'

export default function GettingStarted() {
  const [active, setActive] = useState(SETUP_TABS[0].id)
  const [copied, setCopied] = useState(false)
  const tab = SETUP_TABS.find((t) => t.id === active) ?? SETUP_TABS[0]

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab.command)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section id="getting-started" className="relative py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-72 w-[700px] -translate-x-1/2 rounded-full bg-brand-blue/10 blur-3xl" />
      </div>

      <div className="container-x">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-10">
          {/* Copy */}
          <div className="reveal">
            <span className="section-eyebrow">
              <IconRocket className="h-3.5 w-3.5" />
              Getting Started
            </span>
            <h2 className="mt-5 text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
              Clone, build, and{' '}
              <span className="text-gradient">ship in minutes</span>
            </h2>
            <p className="mt-4 text-pretty text-slate-400">
              Four components, one monorepo. Spin up the smart contracts, the Rust relay, and
              the wallet core with a few commands.
            </p>

            <ul className="mt-8 space-y-3">
              {[
                'Node.js & npm for the Solidity/Hardhat suite',
                'Rust toolchain (cargo) for relay & wallet core',
                'Expo CLI to run the mobile wallet locally',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand-cyan/15 text-brand-cyan">
                    <IconCheck className="h-3.5 w-3.5" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>

            <a href="#download" className="btn-primary group mt-8">
              Read the full docs
              <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Terminal */}
          <div className="reveal" style={{ transitionDelay: '120ms' }}>
            <div className="glass-strong overflow-hidden rounded-2xl shadow-glow-soft">
              {/* window bar */}
              <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-rose-400/80" />
                <span className="h-3 w-3 rounded-full bg-amber-400/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                <span className="ml-3 font-mono text-xs text-slate-500">{tab.filename}</span>
                <button
                  type="button"
                  onClick={copy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-brand-cyan/40 hover:text-white"
                  aria-label="Copy command"
                >
                  {copied ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <IconCopy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              {/* tabs */}
              <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-ink-950/50 px-2 py-2">
                {SETUP_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActive(t.id)
                      setCopied(false)
                    }}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      active === t.id
                        ? 'bg-gradient-to-r from-brand-cyan/20 to-brand-purple/20 text-white ring-1 ring-inset ring-white/10'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* body */}
              <div className="bg-ink-950/60 p-5 font-mono text-sm leading-relaxed sm:p-6">
                <p className="text-slate-500">{tab.comment}</p>
                <div className="mt-2 flex items-start gap-3">
                  <span className="select-none text-brand-purple">$</span>
                  <code className="text-slate-100">
                    {tab.command}
                    <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-brand-cyan/80 align-middle" />
                  </code>
                </div>

                <div className="mt-5 space-y-1.5 text-xs text-slate-500">
                  <p className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                    ready — build artifacts emitted successfully
                  </p>
                  <p className="text-slate-600">
                    tip: run each tab in a separate shell for parallel builds
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
