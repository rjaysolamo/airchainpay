import PaymentBroadcast from '../components/PaymentBroadcast'
import { IconArrowRight, IconBluetooth, IconCode, IconDownload, IconShield } from '../components/icons'
import { CHAINS, GITHUB_URL, HERO_STATS } from '../data/content'

export default function Hero() {
  return (
    <section id="home" className="relative overflow-hidden pt-28 sm:pt-32 lg:pt-40">
      {/* background grid + glows */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-radial-fade blur-2xl" />
      </div>

      <div className="container-x">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
          {/* ---- Copy ---- */}
          <div className="reveal mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
            <div className="mb-5 flex justify-center lg:justify-start">
              <span className="section-eyebrow">
                <IconBluetooth className="h-3.5 w-3.5" />
                Self-custodial · Multi-chain · Offline-first
              </span>
            </div>

            <h1 className="text-balance font-display text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Seamless Crypto Payments.{' '}
              <span className="text-gradient">Anytime, Anywhere</span>
              <span className="whitespace-nowrap">—Even Offline.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-400 lg:mx-0 sm:text-lg">
              AirChainPay is a next-generation self-custodial mobile wallet that leverages
              Bluetooth Low Energy (BLE) and smart contract escrows to power instant
              peer-to-peer crypto transactions without requiring internet access.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start justify-center">
              <a href="#download" className="btn-primary group w-full sm:w-auto">
                <IconDownload className="h-4 w-4" />
                Download Wallet (Expo)
                <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary group w-full sm:w-auto"
              >
                <IconCode className="h-4 w-4 text-brand-cyan" />
                Explore Relay Code
              </a>
            </div>

            {/* trust row */}
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-5 lg:justify-start justify-center">
              <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                <IconShield className="h-4 w-4 text-emerald-400" />
                Non-custodial · Keys never leave your device
              </div>
              <div className="hidden h-4 w-px bg-white/10 sm:block" />
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {CHAINS.map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Visual ---- */}
          <div className="reveal" style={{ transitionDelay: '120ms' }}>
            <PaymentBroadcast />
          </div>
        </div>

        {/* ---- Stats bar ---- */}
        <div className="reveal mt-16 sm:mt-20" style={{ transitionDelay: '200ms' }}>
          <div className="glass grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:grid-cols-4">
            {HERO_STATS.map((s) => (
              <div
                key={s.label}
                className="bg-white/[0.02] px-6 py-7 text-center transition-colors hover:bg-white/[0.05]"
              >
                <div className="font-display text-3xl font-bold text-white sm:text-4xl">
                  <span className="text-gradient-cyan">{s.value}</span>
                </div>
                <div className="mt-1 text-xs uppercase tracking-widest text-slate-500">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
