import { IconArrowRight, IconBluetooth, IconCode, IconDownload } from '../components/icons'
import { GITHUB_URL } from '../data/content'

export default function DownloadCta() {
  return (
    <section id="download" className="relative py-16 sm:py-20">
      <div className="container-x">
        <div className="reveal glass-strong relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12 sm:py-16">
          {/* animated backdrop */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]" />
            <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-cyan/20 blur-3xl animate-glow-pulse" />
            <div
              className="absolute bottom-0 right-10 h-56 w-56 rounded-full bg-brand-purple/20 blur-3xl animate-glow-pulse"
              style={{ animationDelay: '1.4s' }}
            />
          </div>

          <div className="mx-auto flex max-w-2xl flex-col items-center">
            <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-cyan to-brand-purple text-white shadow-glow-blue animate-float">
              <IconBluetooth className="h-7 w-7" />
            </span>
            <h2 className="text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
              Take crypto payments{' '}
              <span className="text-gradient">off the grid</span>
            </h2>
            <p className="mt-4 max-w-xl text-pretty text-slate-400">
              Download the Expo wallet, explore the Rust relay, and start settling
              offline-signed transactions across four EVM testnets today.
            </p>

            <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-primary group w-full sm:w-auto">
                <IconDownload className="h-4 w-4" />
                Download Wallet (Expo)
                <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-secondary group w-full sm:w-auto">
                <IconCode className="h-4 w-4 text-brand-cyan" />
                Explore Relay Code
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
