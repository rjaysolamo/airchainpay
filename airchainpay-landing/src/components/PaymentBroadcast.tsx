import { IconBluetooth, IconCheck, IconRadio, IconWifiOff } from './icons'
import { BLE_SERVICE_UUID } from '../data/content'

/**
 * The hero centerpiece: an animated mobile device broadcasting an encrypted
 * payment over a stylized BLE wave to a nearby merchant terminal.
 * Pure CSS/SVG animation — no runtime JS, respects reduced-motion.
 */
export default function PaymentBroadcast() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -inset-10 -z-10">
        <div className="absolute left-4 top-10 h-56 w-56 rounded-full bg-brand-cyan/20 blur-3xl" />
        <div className="absolute bottom-6 right-6 h-56 w-56 rounded-full bg-brand-purple/20 blur-3xl" />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        {/* ---- Phone ---- */}
        <div className="animate-float">
          <div className="relative mx-auto w-full max-w-[190px]">
            <div className="rounded-[2rem] border border-white/15 bg-gradient-to-b from-ink-800 to-ink-900 p-2 shadow-glow-cyan">
              <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-ink-950">
                {/* notch */}
                <div className="absolute left-1/2 top-2 z-10 h-1.5 w-14 -translate-x-1/2 rounded-full bg-white/15" />
                {/* screen */}
                <div className="space-y-3 px-3 pb-4 pt-6">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="inline-flex items-center gap-1 font-medium text-amber-300/90">
                      <IconWifiOff className="h-3 w-3" /> Offline
                    </span>
                    <span className="font-mono">9:41</span>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">
                      Sending
                    </p>
                    <p className="mt-1 font-display text-xl font-semibold text-white">
                      24.00 <span className="text-brand-cyan">USDC</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-slate-500">
                      to 0x7a3f…B21e
                    </p>
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-brand-cyan/25 bg-brand-cyan/10 px-3 py-2">
                    <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-cyan/20 text-brand-cyan">
                      <IconBluetooth className="h-3.5 w-3.5" />
                    </span>
                    <div className="leading-tight">
                      <p className="text-[10px] font-semibold text-white">Signed & Encrypted</p>
                      <p className="text-[8px] text-slate-400">EIP-712 · AES-256-GCM</p>
                    </div>
                  </div>

                  <div className="h-8 rounded-xl bg-gradient-to-r from-brand-cyan via-brand-blue to-brand-purple p-[1px]">
                    <div className="flex h-full items-center justify-center rounded-[0.65rem] bg-ink-950/40 text-[10px] font-semibold text-white">
                      Tap to Broadcast
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- BLE wave ---- */}
        <div className="relative flex h-full min-h-[150px] items-center justify-center">
          <div className="relative flex items-center justify-center">
            {/* ripple rings */}
            <span className="absolute inline-flex h-16 w-16 rounded-full border border-brand-cyan/50 animate-ripple" />
            <span
              className="absolute inline-flex h-16 w-16 rounded-full border border-brand-sky/40 animate-ripple"
              style={{ animationDelay: '0.9s' }}
            />
            <span
              className="absolute inline-flex h-16 w-16 rounded-full border border-brand-purple/40 animate-ripple"
              style={{ animationDelay: '1.8s' }}
            />
            <span className="relative grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-ink-900 text-brand-cyan shadow-glow-cyan animate-glow-pulse">
              <IconRadio className="h-5 w-5" />
            </span>
          </div>

          {/* travelling packets */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            <span className="absolute left-0 h-1.5 w-1.5 rounded-full bg-brand-cyan shadow-glow-cyan animate-travel-x" />
            <span
              className="absolute left-0 h-1.5 w-1.5 rounded-full bg-brand-purple shadow-glow-purple animate-travel-x"
              style={{ animationDelay: '1.2s' }}
            />
            <span
              className="absolute left-0 h-1 w-1 rounded-full bg-brand-sky animate-travel-x"
              style={{ animationDelay: '2.1s' }}
            />
          </div>
        </div>

        {/* ---- Merchant terminal ---- */}
        <div className="animate-float" style={{ animationDelay: '1.5s' }}>
          <div className="relative mx-auto w-full max-w-[180px]">
            <div className="rounded-2xl border border-white/15 bg-gradient-to-b from-ink-800 to-ink-900 p-3 shadow-glow-purple">
              <div className="rounded-xl border border-white/10 bg-ink-950 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">
                    Merchant
                  </span>
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-emerald-400/15 text-emerald-300">
                    <IconCheck className="h-3 w-3" />
                  </span>
                </div>
                <div className="mt-3 grid place-items-center">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-brand-cyan/20 text-emerald-300">
                    <IconCheck className="h-7 w-7" />
                  </div>
                </div>
                <p className="mt-3 text-center text-[11px] font-semibold text-white">
                  Payment Received
                </p>
                <p className="text-center text-[9px] text-slate-500">Queued for relay</p>
                <div className="mt-2 flex items-center justify-center gap-1">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-300" />
                  <span
                    className="h-1 w-1 animate-pulse rounded-full bg-emerald-300"
                    style={{ animationDelay: '0.2s' }}
                  />
                  <span
                    className="h-1 w-1 animate-pulse rounded-full bg-emerald-300"
                    style={{ animationDelay: '0.4s' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* caption chip */}
      <div className="mt-5 flex justify-center">
        <div className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] text-slate-300">
          <IconBluetooth className="h-3.5 w-3.5 text-brand-cyan" />
          <span className="font-mono">UUID {BLE_SERVICE_UUID}</span>
        </div>
      </div>
    </div>
  )
}
