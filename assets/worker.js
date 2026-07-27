import { analyze } from './analyze.js'

// Analysis is a few seconds of solid number-crunching. Running it on the main
// thread would freeze the loading animation, which is the first thing the
// player ever sees -- so it lives out here.

self.onmessage = (e) => {
  const { pcm, sampleRate } = e.data
  try {
    const songMap = analyze(pcm, sampleRate, (progress) => {
      self.postMessage({ type: 'progress', progress })
    })
    self.postMessage({ type: 'done', songMap })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) })
  }
}
