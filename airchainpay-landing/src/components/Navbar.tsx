import { useEffect, useState } from 'react'
import Logo from './Logo'
import { IconArrowRight, IconClose, IconMenu } from './icons'
import { NAV_LINKS } from '../data/content'
import { useActiveSection } from '../hooks/useActiveSection'

const SECTION_IDS = ['features', 'architecture', 'security', 'getting-started']

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const active = useActiveSection(SECTION_IDS)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={`transition-all duration-300 ${
          scrolled
            ? 'border-b border-white/10 bg-ink-950/70 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <nav className="container-x flex h-16 items-center justify-between md:h-[72px]">
          <Logo />

          {/* Desktop links */}
          <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1.5 backdrop-blur-md lg:flex">
            {NAV_LINKS.map((link) => {
              const id = link.href.replace('#', '')
              const isActive = active === id
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <span className="absolute inset-0 rounded-full bg-gradient-to-r from-brand-cyan/20 to-brand-purple/20 ring-1 ring-inset ring-white/10" />
                  )}
                  <span className="relative">{link.label}</span>
                </a>
              )
            })}
          </div>

          {/* Desktop CTA */}
          <div className="hidden items-center gap-3 lg:flex">
            <a href="#getting-started" className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
              Docs
            </a>
            <a href="#download" className="btn-primary group text-sm">
              Launch App
              <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <IconClose className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
          </button>
        </nav>
      </div>

      {/* Mobile drawer */}
      <div
        className={`lg:hidden ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        <div
          onClick={() => setOpen(false)}
          className={`fixed inset-0 top-16 bg-ink-950/60 backdrop-blur-sm transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          className={`absolute inset-x-0 top-16 origin-top px-4 transition-all duration-300 ${
            open ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
          }`}
        >
          <div className="glass-strong rounded-2xl p-3 shadow-glow-soft">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between rounded-xl px-4 py-3.5 text-base font-medium text-slate-200 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
                <IconArrowRight className="h-4 w-4 text-slate-500" />
              </a>
            ))}
            <a
              href="#download"
              onClick={() => setOpen(false)}
              className="btn-primary mt-2 w-full"
            >
              Launch App
              <IconArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </header>
  )
}
