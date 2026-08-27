import Logo from '../components/Logo'
import {
  IconArrowRight,
  IconBook,
  IconGitHub,
  IconLayers,
  IconShield,
} from '../components/icons'
import { CHAINS, FOOTER_LINKS, GITHUB_URL, NAV_LINKS } from '../data/content'

const ICON_MAP = {
  github: IconGitHub,
  book: IconBook,
  layers: IconLayers,
  shield: IconShield,
}

export default function Footer() {
  return (
    <footer className="relative border-t border-white/10 pt-16">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-brand-blue/5 to-transparent" />

      <div className="container-x">
        <div className="grid gap-12 pb-12 lg:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              A next-generation self-custodial multi-chain wallet powering instant, secure
              crypto payments online and offline over Bluetooth Low Energy.
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {CHAINS.map((c) => (
                <span key={c} className="chip text-[11px]">
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Navigate */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Navigate
            </h3>
            <ul className="mt-4 space-y-3">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="group inline-flex items-center gap-2 text-sm text-slate-300 transition-colors hover:text-white"
                  >
                    <IconArrowRight className="h-3.5 w-3.5 text-slate-600 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-brand-cyan" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              Quick Links
            </h3>
            <ul className="mt-4 space-y-3">
              {FOOTER_LINKS.map((link) => {
                const Icon = ICON_MAP[link.icon]
                const external = link.href.startsWith('http')
                return (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                      className="group inline-flex items-center gap-2.5 text-sm text-slate-300 transition-colors hover:text-white"
                    >
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.05] text-slate-400 transition-colors group-hover:bg-brand-cyan/15 group-hover:text-brand-cyan">
                        <Icon className="h-4 w-4" />
                      </span>
                      {link.label}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 py-7 sm:flex-row">
          <p className="text-xs text-slate-500">
            © 2026 AirChainPay. Licensed under the{' '}
            <span className="text-slate-400">MIT License</span>.
          </p>
          <div className="flex items-center gap-4">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-slate-400 transition-colors hover:text-white"
            >
              <IconGitHub className="h-4 w-4" />
              rjaysolamo/airchainpay
            </a>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Testnet live
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
