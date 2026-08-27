interface LogoProps {
  className?: string
  showWordmark?: boolean
}

/**
 * AirChainPay brand mark — the official app icon (Bluetooth + blockchain link),
 * wrapped in a soft neon glow to match the site aesthetic.
 */
export default function Logo({ className = '', showWordmark = true }: LogoProps) {
  return (
    <a href="#home" className={`group inline-flex items-center gap-2.5 ${className}`}>
      <span className="relative grid h-10 w-10 place-items-center">
        <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-cyan/30 to-brand-purple/30 blur-md opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
        <img
          src="/airchainpay-logo.png"
          alt="AirChainPay logo"
          width={40}
          height={40}
          className="relative h-10 w-10 rounded-xl object-cover ring-1 ring-white/10 drop-shadow-[0_0_10px_rgba(34,211,238,0.35)] transition-transform duration-300 group-hover:scale-105"
        />
      </span>
      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight text-white">
          Air<span className="text-gradient">Chain</span>Pay
        </span>
      )}
    </a>
  )
}
