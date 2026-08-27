import Navbar from './components/Navbar'
import Hero from './sections/Hero'
import ProblemSolution from './sections/ProblemSolution'
import Architecture from './sections/Architecture'
import HowItWorks from './sections/HowItWorks'
import Security from './sections/Security'
import GettingStarted from './sections/GettingStarted'
import DownloadCta from './sections/DownloadCta'
import Footer from './sections/Footer'
import { useReveal } from './hooks/useReveal'

export default function App() {
  useReveal()

  return (
    <div className="relative min-h-screen overflow-x-clip">
      {/* Skip link for accessibility */}
      <a
        href="#home"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand-blue focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <Navbar />

      <main>
        <Hero />
        <ProblemSolution />
        <Architecture />
        <HowItWorks />
        <Security />
        <GettingStarted />
        <DownloadCta />
      </main>

      <Footer />
    </div>
  )
}
