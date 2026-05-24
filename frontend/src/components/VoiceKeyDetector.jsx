import { useCallback, useEffect, useRef, useState } from 'react'
import { api, serverReady } from '../api'

const MAX_SECONDS = 30      // long enough for Render free-tier cold start (~20-25s)
const POLL_MS = 1500        // how often to check while recording
const WINDOW_SECS = 4.0     // seconds of audio sent each poll
const HIGH_CONFIDENCE = 0.85 // accept on first poll if confidence is this high
const AGREE_NEEDED = 2      // consecutive matching results to auto-confirm

function encodeWav(samples, sampleRate) {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }

  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, dataLen, true)

  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    off += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

// Grab the last `windowSecs` of audio from the chunks array efficiently.
function getRecentSamples(chunks, sampleRate, windowSecs) {
  const needed = Math.floor(sampleRate * windowSecs)
  let total = 0
  for (const c of chunks) total += c.length

  const take = Math.min(needed, total)
  const out = new Float32Array(take)
  let filled = take
  for (let i = chunks.length - 1; i >= 0 && filled > 0; i--) {
    const chunk = chunks[i]
    const n = Math.min(chunk.length, filled)
    out.set(chunk.subarray(chunk.length - n), filled - n)
    filled -= n
  }
  return out
}

export function VoiceKeyDetector() {
  const [phase, setPhase] = useState('idle') // idle | recording | analyzing | result | error
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [warming, setWarming] = useState(true)

  useEffect(() => {
    serverReady.then(() => setWarming(false))
  }, [])

  const recRef = useRef(null)

  const teardown = useCallback((rec) => {
    if (!rec) return
    clearInterval(rec.ticker)
    clearInterval(rec.pollTimer)
    rec.abort.abort()
    try { rec.processor.disconnect() } catch {}
    try { rec.source.disconnect() } catch {}
    rec.stream.getTracks().forEach(t => t.stop())
    rec.ctx.close()
  }, [])

  const finishWithData = useCallback((data, rec) => {
    teardown(rec)
    setResult(data)
    setPhase('result')
  }, [teardown])

  // Manual stop — uses last polled result instantly if available
  const stopEarly = useCallback(async () => {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null

    teardown(rec)

    if (rec.lastResult) {
      setResult(rec.lastResult)
      setPhase('result')
      return
    }

    const totalLen = rec.chunks.reduce((a, c) => a + c.length, 0)
    if (totalLen < rec.sampleRate * 0.5) {
      setPhase('error')
      setErrorMsg('Recording too short — sing for at least 1 second.')
      return
    }

    const merged = new Float32Array(totalLen)
    let off = 0
    for (const chunk of rec.chunks) { merged.set(chunk, off); off += chunk.length }

    setPhase('analyzing')
    try {
      const data = await api.detectKey(encodeWav(merged, rec.sampleRate))
      setResult(data)
      setPhase('result')
    } catch (e) {
      const msg = e?.message || ''
      const isNetwork = /load failed|failed to fetch|networkerror/i.test(msg)
      setPhase('error')
      setErrorMsg(isNetwork
        ? 'Could not reach the server — it may be starting up. Wait a moment and try again.'
        : msg || 'Key detection failed.')
    }
  }, [teardown])

  const startRecording = useCallback(async () => {
    setPhase('recording')
    setElapsed(0)
    setResult(null)
    setErrorMsg('')

    // Create AudioContext synchronously while still inside the user-gesture call stack.
    // On Safari, creating it after an await loses the activation context and the
    // context starts suspended — onaudioprocess never fires and no audio is collected.
    const ctx = new (window.AudioContext || window.webkitAudioContext)()

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      ctx.close()
      setPhase('error')
      setErrorMsg('Microphone access denied. Please allow microphone access in your browser.')
      return
    }

    // Explicitly resume in case the browser auto-suspended the context.
    try {
      await ctx.resume()
    } catch {
      ctx.close()
      stream.getTracks().forEach(t => t.stop())
      setPhase('error')
      setErrorMsg('Could not start audio. Try again or use a different browser.')
      return
    }
    const sampleRate = ctx.sampleRate
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const chunks = []

    processor.onaudioprocess = (e) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }

    const silencer = ctx.createGain()
    silencer.gain.value = 0
    source.connect(processor)
    processor.connect(silencer)
    silencer.connect(ctx.destination)

    let secs = 0
    const ticker = setInterval(() => {
      secs++
      setElapsed(secs)
      if (secs >= MAX_SECONDS) stopEarly()
    }, 1000)

    const rec = {
      ctx, source, processor, stream, chunks, ticker, sampleRate,
      pollTimer: null, lastResult: null, agree: 0, lastKey: null,
      abort: new AbortController(),
    }

    const pollTimer = setInterval(async () => {
      const r = recRef.current
      if (!r) return

      const samples = getRecentSamples(r.chunks, r.sampleRate, WINDOW_SECS)
      if (samples.length < r.sampleRate * 0.5) return

      let data
      try {
        data = await api.detectKey(encodeWav(samples, r.sampleRate), r.abort.signal)
      } catch {
        return
      }

      // Guard: recording may have stopped while awaiting the fetch
      if (recRef.current !== r) return

      const key = `${data.key}-${data.mode}`
      if (key === r.lastKey) {
        r.agree++
      } else {
        r.lastKey = key
        r.agree = 1
      }
      r.lastResult = data

      if (data.confidence >= HIGH_CONFIDENCE || r.agree >= AGREE_NEEDED) {
        recRef.current = null
        finishWithData(data, r)
      }
    }, POLL_MS)

    rec.pollTimer = pollTimer
    recRef.current = rec
  }, [stopEarly, finishWithData])

  useEffect(() => {
    return () => {
      const rec = recRef.current
      recRef.current = null
      teardown(rec)
    }
  }, [teardown])

  const reset = () => { setPhase('idle'); setResult(null); setErrorMsg('') }

  return (
    <div className="w-full max-w-sm">
      <div className="card p-8 text-center">

        {phase === 'idle' && (
          <>
            <button
              onClick={startRecording}
              disabled={warming}
              className="w-[5rem] h-[5rem] rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center mx-auto mb-5 transition-all active:scale-95 hover:ring-2 hover:ring-zinc-600"
            >
              {warming
                ? <div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                : <MicIcon className="w-8 h-8 text-zinc-300" />}
            </button>
            <p className="text-base font-semibold text-zinc-200 mb-1">
              {warming ? 'Server warming up…' : 'Tap to start singing'}
            </p>
            <p className="text-xs text-zinc-600">
              {warming ? 'This takes ~20s on first load' : 'Sing, hum, or whistle · mic required'}
            </p>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="relative w-[5rem] h-[5rem] mx-auto mb-5">
              <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
              <button
                onClick={stopEarly}
                className="relative w-full h-full rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all active:scale-95"
              >
                <StopIcon className="w-7 h-7 text-white" />
              </button>
            </div>
            <p className="text-base font-semibold text-white mb-1">
              Listening… <span className="font-mono text-red-400">{elapsed}s</span>
            </p>
            <p className="text-xs text-zinc-600">Auto-detects key · tap to stop early</p>
          </>
        )}

        {phase === 'analyzing' && (
          <>
            <div className="w-[5rem] h-[5rem] rounded-full bg-violet-900/40 flex items-center justify-center mx-auto mb-5">
              <div className="w-9 h-9 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-sm text-zinc-400">Detecting key…</p>
          </>
        )}

        {phase === 'result' && result && (
          <>
            <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Detected Key</p>
            <div className="flex items-baseline justify-center gap-3 mb-5">
              <span className="text-7xl font-bold font-mono text-violet-300">{result.key}</span>
              <span className="text-3xl font-semibold text-zinc-400 capitalize">{result.mode}</span>
            </div>

            <div className="mb-2">
              <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-2">Scale Notes</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {result.scale.map(n => (
                  <span key={n} className="px-3 py-1.5 bg-zinc-800 rounded-lg text-sm font-mono font-medium text-zinc-300">
                    {n}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-border">
              <button
                onClick={reset}
                className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-all active:scale-95"
              >
                Sing Again
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="w-[5rem] h-[5rem] rounded-full bg-red-900/30 flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">⚠️</span>
            </div>
            <p className="text-sm text-red-400 mb-5 leading-relaxed">{errorMsg}</p>
            <button
              onClick={reset}
              className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-all active:scale-95"
            >
              Try Again
            </button>
          </>
        )}

      </div>
    </div>
  )
}

function MicIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function StopIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
