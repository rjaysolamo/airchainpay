import { IconArrowRight, IconBluetooth, IconBolt, IconWifiOff } from '../components/icons'

export default function ProblemSolution() {
  return (
    <section id="features" className="relative py-24 sm:py-28">
      <div className="container-x">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="section-eyebrow">The Problem &amp; The Solution</span>
          <h2 className="mt-5 text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
            The internet goes down.{' '}
            <span className="text-gradient">Your payments shouldn’t.</span>
          </h2>
          <p className="mt-4 text-pretty text-slate-400">
            Most crypto wallets assume you are always online. AirChainPay is engineered for
            the moments when you are not.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:gap-4">
          {/* Problem */}
          <article className="reveal glass card-hover group relative overflow-hidden rounded-3xl p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl" />
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-rose-300">
              <IconWifiOff className="h-3.5 w-3.5" />
              The Problem
            </div>
            <h3 className="mt-5 text-2xl font-semibold text-white">
              Wallets are hostage to connectivity
            </h3>
            <p className="mt-3 leading-relaxed text-slate-400">
              Traditional crypto wallets are entirely dependent on active internet connections.
              If a merchant has spotty cellular coverage or a consumer is offline, transaction
              execution completely halts.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'No signal, no sale — checkout simply stops',
                'Rural, transit & event venues left unserved',
                'Failed broadcasts and stuck pending states',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                  {t}
                </li>
              ))}
            </ul>
          </article>

          {/* connector */}
          <div className="reveal flex items-center justify-center lg:flex-col">
            <div className="hidden h-full w-px bg-gradient-to-b from-transparent via-white/15 to-transparent lg:block" />
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-ink-900 text-brand-cyan shadow-glow-cyan lg:my-4">
              <IconArrowRight className="h-6 w-6 lg:rotate-90 xl:rotate-0" />
            </div>
            <div className="hidden h-full w-px bg-gradient-to-b from-transparent via-white/15 to-transparent lg:block" />
          </div>

          {/* Solution */}
          <article className="reveal glass card-hover group relative overflow-hidden rounded-3xl p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-cyan/10 blur-3xl" />
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-brand-cyan">
              <IconBolt className="h-3.5 w-3.5" />
              The Solution
            </div>
            <h3 className="mt-5 text-2xl font-semibold text-white">
              Sign now, settle later — over the air
            </h3>
            <p className="mt-3 leading-relaxed text-slate-400">
              AirChainPay introduces peer-to-peer offline transaction signing on-device, stores
              signed payloads in a local queue, and uses secure BLE transfers to hand off
              transactions to the merchant — who relays them to the blockchain once back online.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                { t: 'On-device offline signing with a local queue', i: IconBolt },
                { t: 'Encrypted hand-off over Bluetooth Low Energy', i: IconBluetooth },
                { t: 'Merchant relays to chain when internet returns', i: IconArrowRight },
              ].map(({ t, i: I }) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-200">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
                    <I className="h-3.5 w-3.5" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
