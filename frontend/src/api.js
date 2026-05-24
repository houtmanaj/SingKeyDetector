const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001'

// Kick the backend awake as soon as the module loads and expose a promise so the
// UI can show a "warming up" state instead of silently failing on cold start.
export const serverReady = fetch(`${BASE}/health`)
  .then(r => r.ok)
  .catch(() => false)

export const api = {
  async detectKey(wavBlob, signal) {
    const form = new FormData()
    form.append('file', wavBlob, 'recording.wav')
    const res = await fetch(`${BASE}/detect-key`, { method: 'POST', body: form, signal })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Key detection failed')
    }
    return res.json()
  },
}
