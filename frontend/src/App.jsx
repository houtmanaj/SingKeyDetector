import { VoiceKeyDetector } from './components/VoiceKeyDetector'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-violet-600 rounded-2xl flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <span className="text-4xl font-bold tracking-tight">SingKey</span>
        </div>
        <p className="text-zinc-400 text-sm max-w-xs">
          Sing, hum, or whistle a melody — instantly detect the musical key.
        </p>
      </div>

      {/* Detector card */}
      <VoiceKeyDetector />

      <p className="mt-8 text-zinc-700 text-xs">
        Powered by librosa · Krumhansl-Schmuckler algorithm
      </p>
    </div>
  )
}
