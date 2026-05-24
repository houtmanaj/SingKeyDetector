const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001'

// Kick the backend awake as soon as the page loads.
// Render free tier sleeps after inactivity; this gives it a ~20s head-start
// so it's ready by the time the user clicks the mic button.
fetch(`${BASE}/health`).catch(() => {})

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
