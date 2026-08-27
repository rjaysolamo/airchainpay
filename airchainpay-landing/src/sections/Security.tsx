import { SECURITY } from '../data/content'
import { IconCheck, IconKey, IconLock, IconShield } from '../components/icons'

export default function Security() {
  return (
    <section id="security" className="relative py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute right-1/4 top-10 h-72 w-72 rounded-full bg-brand-blue/10 blur-3xl" />
        <div className="absolute left-1/4 bottom-10 h-72 w-72 rounded-full bg-brand-purple/10 blur-3xl" />
      </div>

      <div className="container-x">
        <div className="reveal mx-auto max-w-2xl text-center">
          <span className="section-eyebrow">
            <IconShield className="h-3.5 w-3.5" />
            Uncompromising Security
          </span>
          <h2 className="mt-5 text-balance text-3xl font-bold sm:text-4xl lg:text-5xl">
            Security enforced in <span className="text-gradient">Rust</span> and on-chain
          </h2>
          <p className="mt-4 text-pretty text-slate-400">
            Offline doesn’t mean unsafe. Cryptographic guarantees protect every payment from
            memory to mainnet.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {SECURITY.map((item, i) => {
            const Icon = item.icon
            return (
              <article
                key={item.id}
                className="reveal glass card-hover group relative overflow-hidden rounded-3xl p-7"
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <div
                  className={`pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${item.accent} opacity-10 blur-3xl transition-opacity duration-500 group-hover:opacity-25`}
                />
                <div className="flex items-center justify-between">
                  <span
                    className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${item.accent} text-white shadow-glow-blue`}
                  >
                    <Icon className="h-7 w-7" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                    <IconCheck className="h-3 w-3" />
                    {item.badge}
                  </span>
                </div>

                <h3 className="mt-6 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </article>
            )
          })}
        </div>

        {/* Assurance strip */}
        <div className="reveal mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: IconKey, label: 'secp256k1 signing' },
            { icon: IconLock, label: 'AES-256-GCM encryption' },
            { icon: IconShield, label: 'iOS Keychain / Android Keystore' },
            { icon: IconCheck, label: 'EIP-712 typed payloads' },
          ].map(({ icon: I, label }) => (
            <div
              key={label}
              className="glass flex items-center gap-3 rounded-2xl px-4 py-4 text-sm text-slate-200"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-brand-cyan">
                <I className="h-4 w-4" />
              </span>
              <span className="font-mono text-xs sm:text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
