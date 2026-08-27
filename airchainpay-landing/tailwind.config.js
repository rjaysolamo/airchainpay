/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#04050c',
          900: '#070912',
          850: '#0a0d1a',
          800: '#0e1120',
          700: '#141830',
          600: '#1c2140',
        },
        brand: {
          cyan: '#22d3ee',
          sky: '#38bdf8',
          blue: '#3b82f6',
          indigo: '#6366f1',
          purple: '#a855f7',
          fuchsia: '#d946ef',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 45px -8px rgba(34,211,238,0.55)',
        'glow-blue': '0 0 45px -8px rgba(59,130,246,0.55)',
        'glow-purple': '0 0 45px -8px rgba(168,85,247,0.55)',
        'glow-soft': '0 8px 40px -12px rgba(56,189,248,0.35)',
        'inner-glow': 'inset 0 1px 0 0 rgba(255,255,255,0.08)',
      },
      backgroundImage: {
        'grid-lines':
          'linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)',
        'radial-fade':
          'radial-gradient(circle at 50% 0%, rgba(56,189,248,0.14), transparent 55%)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) translateX(0)' },
          '50%': { transform: 'translateY(-22px) translateX(8px)' },
        },
        ripple: {
          '0%': { transform: 'scale(0.35)', opacity: '0.9' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'gradient-x': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'spin-slow': {
          '100%': { transform: 'rotate(360deg)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'travel-x': {
          '0%': { transform: 'translateX(-10%)', opacity: '0' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { transform: 'translateX(320%)', opacity: '0' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        ripple: 'ripple 2.8s ease-out infinite',
        'gradient-x': 'gradient-x 6s ease infinite',
        shimmer: 'shimmer 2.5s infinite',
        marquee: 'marquee 30s linear infinite',
        'fade-up': 'fade-up 0.7s ease forwards',
        blink: 'blink 1.1s step-end infinite',
        'spin-slow': 'spin-slow 18s linear infinite',
        'glow-pulse': 'glow-pulse 3.5s ease-in-out infinite',
        'travel-x': 'travel-x 3.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
