import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps) => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0 0l4-4m-4 4l-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

export const IconCode = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
  </svg>
)

export const IconWifiOff = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18" />
    <path d="M9.5 15.5a3.5 3.5 0 0 1 5 0" />
    <path d="M6 12.5a8 8 0 0 1 3-2" />
    <path d="M18.5 12.5a8 8 0 0 0-3.2-2.1" />
    <path d="M2.5 9a13 13 0 0 1 4-2.6M21.5 9a13 13 0 0 0-8-3.4" />
    <path d="M12 19h.01" />
  </svg>
)

export const IconBluetooth = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 7l10 10-5 4V3l5 4L7 17" />
  </svg>
)

export const IconShield = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </svg>
)

export const IconLock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <path d="M12 15v2" />
  </svg>
)

export const IconCpu = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10.5 10.5h3v3h-3z" />
    <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
  </svg>
)

export const IconServer = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
)

export const IconContract = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M13 3v4h4" />
    <path d="M9 12h6M9 15.5h6M9 8.5h2" />
  </svg>
)

export const IconPhone = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="2.5" width="12" height="19" rx="3" />
    <path d="M10.5 5.5h3" />
    <path d="M11 18.5h2" />
  </svg>
)

export const IconQr = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h4v-3" />
  </svg>
)

export const IconLayers = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l9 5-9 5-9-5 9-5Z" />
    <path d="M3 12l9 5 9-5" />
    <path d="M3 16.5l9 5 9-5" />
  </svg>
)

export const IconVault = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 8.5v-1M12 16.5v-1M8.5 12h-1M16.5 12h-1" />
  </svg>
)

export const IconSignature = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 17c3 0 3-9 6-9s2 7 4 7 2-4 4-4 1.5 2 4 2" />
    <path d="M3 20.5h18" />
  </svg>
)

export const IconRadio = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
    <path d="M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" />
  </svg>
)

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 8a8 8 0 0 0-14.5-2M4 6v4h4" />
    <path d="M4 16a8 8 0 0 0 14.5 2M20 18v-4h-4" />
  </svg>
)

export const IconGavel = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 3l7 7-3 3-7-7 3-3Z" />
    <path d="M12 5l-8 8 3 3 8-8" />
    <path d="M3 21h9" />
  </svg>
)

export const IconMemory = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 7V5M11 7V5M13 7V5M17 7V5" />
    <path d="M7 12h.01M11 12h.01M15 12h.01" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
)

export const IconGitHub = (p: IconProps) => (
  <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor" stroke="none">
    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
  </svg>
)

export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
  </svg>
)

export const IconRocket = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2" />
    <path d="M9 12c1-4 4-8 10-8 0 6-4 9-8 10l-2-2Z" />
    <circle cx="14.5" cy="9.5" r="1.3" />
  </svg>
)

export const IconBolt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2L5 13h6l-1 9 8-11h-6l1-9Z" />
  </svg>
)

export const IconGlobe = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9Z" />
  </svg>
)

export const IconKey = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="4" />
    <path d="M11 11l8 8M16 16l2-2M14 18l2-2" />
  </svg>
)

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconChip = IconCpu
