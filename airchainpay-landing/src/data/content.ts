import type { ComponentType, SVGProps } from 'react'
import {
  IconBluetooth,
  IconContract,
  IconCpu,
  IconGavel,
  IconLock,
  IconMemory,
  IconPhone,
  IconQr,
  IconRadio,
  IconRefresh,
  IconServer,
  IconSignature,
  IconVault,
} from '../components/icons'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

export const GITHUB_URL = 'https://github.com/rjaysolamo/airchainpay.git'
export const BLE_SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb'

export const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Security', href: '#security' },
  { label: 'Getting Started', href: '#getting-started' },
] as const

export const HERO_STATS = [
  { value: '~1000', label: 'Relay TPS' },
  { value: '<50MB', label: 'Relay RAM' },
  { value: '4', label: 'EVM Chains' },
  { value: '0', label: 'Keys in RAM' },
] as const

export const CHAINS = [
  'Core Testnet',
  'Base Sepolia',
  'Lisk Sepolia',
  'Morph Holesky',
] as const

export interface ArchTier {
  id: string
  index: string
  title: string
  stack: string
  icon: Icon
  accent: string
  glow: string
  summary: string
  points: string[]
}

export const ARCHITECTURE: ArchTier[] = [
  {
    id: 'wallet',
    index: '01',
    title: 'The Mobile Wallet',
    stack: 'React Native / Expo',
    icon: IconPhone,
    accent: 'from-brand-cyan to-brand-sky',
    glow: 'shadow-glow-cyan',
    summary:
      'A self-custodial multi-chain wallet built for real-world payments on the go.',
    points: [
      'Multi-chain support (Base Sepolia, Core Testnet)',
      'QR code scanning for payment addresses',
      'Transaction history tracking',
      'Secure local offline transaction queue',
    ],
  },
  {
    id: 'core',
    index: '02',
    title: 'Wallet Core',
    stack: 'Rust',
    icon: IconCpu,
    accent: 'from-brand-sky to-brand-blue',
    glow: 'shadow-glow-blue',
    summary:
      'A high-performance cryptographic engine with direct secure-hardware integration.',
    points: [
      'Key management & secp256k1 signing',
      'AES-256-GCM data encryption',
      'iOS Keychain & Android Keystore integration',
      'Zero memory exposure of private keys',
    ],
  },
  {
    id: 'relay',
    index: '03',
    title: 'Rust Relay Server',
    stack: 'Rust',
    icon: IconServer,
    accent: 'from-brand-blue to-brand-indigo',
    glow: 'shadow-glow-blue',
    summary:
      'A high-throughput, low-latency bridge from signed payloads to the blockchain.',
    points: [
      '~1000 TPS throughput',
      '<50MB RAM footprint',
      'Validates signed payment payloads',
      'Broadcasts directly to EVM blockchains',
    ],
  },
  {
    id: 'contracts',
    index: '04',
    title: 'Smart Contracts',
    stack: 'Solidity v0.8.x',
    icon: IconContract,
    accent: 'from-brand-indigo to-brand-purple',
    glow: 'shadow-glow-purple',
    summary:
      'EVM-compatible contracts that verify offline-signed transactions and settle payments.',
    points: [
      'Deployed on Core, Base, Lisk & Morph testnets',
      'Verifies offline-signed transactions',
      'Manages fee collection',
      'Processes batch payments',
    ],
  },
]

export interface FlowStep {
  id: string
  step: string
  title: string
  icon: Icon
  accent: string
  body: string
  tags: string[]
}

export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'deposit',
    step: '01',
    title: 'Deposit & Cooldown Lock',
    icon: IconVault,
    accent: 'from-brand-cyan to-brand-sky',
    body: 'The consumer locks native assets (ETH/CORE) or ERC-20s (USDC/USDT) into the OfflineSecurityVault before going offline. Reclaiming unused funds is gated by a 1-day cooldown to ensure offline commitments stay backed.',
    tags: ['OfflineSecurityVault', '1-day cooldown', 'ETH · CORE · USDC · USDT'],
  },
  {
    id: 'signing',
    step: '02',
    title: 'Offline Local Signing',
    icon: IconSignature,
    accent: 'from-brand-sky to-brand-blue',
    body: 'When offline, the consumer initiates a payment. The Rust Wallet Core constructs an EIP-712 payload and signs it locally on-device — no network required.',
    tags: ['EIP-712', 'On-device', 'secp256k1'],
  },
  {
    id: 'ble',
    step: '03',
    title: 'BLE Transfer',
    icon: IconBluetooth,
    accent: 'from-brand-blue to-brand-indigo',
    body: `The payment data is serialized, encrypted with AES-256-GCM, and transmitted over Bluetooth Low Energy using Service UUID ${BLE_SERVICE_UUID}.`,
    tags: ['AES-256-GCM', 'BLE', 'Serialized payload'],
  },
  {
    id: 'settlement',
    step: '04',
    title: 'Relay & Settlement',
    icon: IconRadio,
    accent: 'from-brand-indigo to-brand-purple',
    body: 'The merchant queues the payload offline, then pushes it to the Rust Relay Server once internet returns. The relay broadcasts it and the smart contracts settle the payment instantly.',
    tags: ['Offline queue', 'Relay broadcast', 'Instant settle'],
  },
]

export interface SecurityFeature {
  id: string
  title: string
  icon: Icon
  accent: string
  body: string
  badge: string
}

export const SECURITY: SecurityFeature[] = [
  {
    id: 'memory',
    title: 'Zero Memory Exposure',
    icon: IconMemory,
    accent: 'from-brand-cyan to-brand-blue',
    badge: 'RAM-safe',
    body: 'All private keys and signatures are handled inside Rust and instantly zeroed out when dropped, leaving no trace in RAM.',
  },
  {
    id: 'replay',
    title: 'Replay Protection',
    icon: IconRefresh,
    accent: 'from-brand-blue to-brand-indigo',
    badge: 'Nonce-tracked',
    body: 'On-chain mapping tracks sequential logical nonces, ensuring offline transactions are settled chronologically without gaps.',
  },
  {
    id: 'slashing',
    title: 'Slashing & Double-Spend Proofs',
    icon: IconGavel,
    accent: 'from-brand-indigo to-brand-purple',
    badge: 'Cryptographic proof',
    body: 'If an offender signs two conflicting payments for the same sequence slot, anyone can submit the signatures as a double-spend proof. The vault slashes the offender’s entire escrow and pays it to the victim.',
  },
]

export interface SetupTab {
  id: string
  label: string
  filename: string
  command: string
  comment: string
}

export const SETUP_TABS: SetupTab[] = [
  {
    id: 'clone',
    label: 'Clone repo',
    filename: 'terminal — clone',
    comment: '# Clone the AirChainPay monorepo',
    command: 'git clone https://github.com/rjaysolamo/airchainpay.git',
  },
  {
    id: 'contracts',
    label: 'Smart Contracts',
    filename: 'terminal — contracts',
    comment: '# Install deps & compile Solidity contracts',
    command: 'cd airchainpay-contracts && npm install && npx hardhat compile',
  },
  {
    id: 'relay',
    label: 'Relay Server',
    filename: 'terminal — relay',
    comment: '# Build the high-throughput Rust relay',
    command: 'cd airchainpay-relay-rust/airchainpay-relay && cargo build',
  },
  {
    id: 'core',
    label: 'Wallet Core',
    filename: 'terminal — wallet-core',
    comment: '# Build the Rust cryptographic core (release)',
    command: 'cd airchainpay-wallet-core && cargo build --release',
  },
]

export const FOOTER_LINKS = [
  { label: 'GitHub Repository', icon: 'github' as const, href: GITHUB_URL },
  { label: 'Developer Docs', icon: 'book' as const, href: '#getting-started' },
  { label: 'Hardhat Deployments', icon: 'layers' as const, href: '#architecture' },
  { label: 'Security Audits', icon: 'shield' as const, href: '#security' },
]

export {
  IconLock,
  IconQr,
}
