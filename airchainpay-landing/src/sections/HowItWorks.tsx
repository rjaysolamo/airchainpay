import { useState } from 'react'
import { FLOW_STEPS } from '../data/content'
import { IconBolt } from '../components/icons'

export default function HowItWorks() {
  const [active, setActive] = useState(0)
  const step = FLOW_STEPS[active]
  const ActiveIcon = step.icon

  return (
    <section id="how-it-works" className="relative py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(60%_50%_at_50%_50%,black,transparent)]" />

      <div className="container-x">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="section-eyebrow">
            <IconBolt className="h-3.5 w-3.5" />
            Technical Deep Dive
          </span>
          <h2 className="mt-5 text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
            How <span className="text-gradient">offline payments</span> actually work
          </h2>
          <p className="mt-4 text-pretty text-slate-400">
            Four precise steps take a payment from a locked vault to on-chain settlement —
            without ever touching the internet at the point of sale.
          </p>
        </div>

        {/* Timeline rail */}
        <div className="reveal mt-16">
          <div className="relative">
            {/* base line */}
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-white/10 md:block" />
            {/* progress line */}
            <div
              className="absolute left-0 top-6 hidden h-px bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple transition-all duration-500 md:block"
              style={{ width: `${(active / (FLOW_STEPS.length - 1)) * 100}%` }}
            />

            <ol className="grid gap-8 md:grid-cols-4 md:gap-4">
              {FLOW_STEPS.map((s, i) => {
                const isActive = i === active
                const isDone = i < active
                return (
                  <li key={s.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setActive(i)}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      className="group flex w-full items-center gap-4 text-left md:flex-col md:items-start md:gap-0"
                    >
                      {/* node */}
                      <span className="relative z-10 md:mb-6">
                        <span
                          className={`grid h-12 w-12 place-items-center rounded-full border font-mono text-sm font-semibold transition-all duration-300 ${
                            isActive
                              ? 'border-transparent bg-gradient-to-br from-brand-cyan to-brand-purple text-white shadow-glow-blue scale-105'
                              : isDone
                                ? 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan'
                                : 'border-white/15 bg-ink-900 text-slate-500 group-hover:border-white/30'
                          }`}
                        >
                          {s.step}
                        </span>
                      </span>
                      {/* label */}
                      <span className="md:pr-4">
                        <span
                          className={`block text-sm font-semibold transition-colors ${
                            isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          {s.title}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Active detail card */}
          <div className="mt-10">
            <div key={step.id} className="glass relative overflow-hidden rounded-3xl p-8 animate-fade-up sm:p-10">
              <div
                className={`pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-gradient-to-br ${step.accent} opacity-20 blur-3xl`}
              />
              <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
                <div
                  className={`grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${step.accent} text-white shadow-glow-blue`}
                >
                  <ActiveIcon className="h-10 w-10" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-brand-cyan">Step {step.step}</span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{step.title}</h3>
                  <p className="mt-3 max-w-2xl leading-relaxed text-slate-400">{step.body}</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {step.tags.map((t) => (
                      <span key={t} className="chip font-mono text-[11px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* nav dots (mobile-friendly) */}
            <div className="mt-6 flex items-center justify-center gap-2">
              {FLOW_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Go to step ${s.step}`}
                  onClick={() => setActive(i)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === active ? 'w-8 bg-brand-cyan' : 'w-2 bg-white/20 hover:bg-white/40'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
