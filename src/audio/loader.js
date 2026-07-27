const ACCEPTED = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i

export function isAudioFile(file) {
  return file.type.startsWith('audio/') || ACCEPTED.test(file.name)
}

/** Average all channels down to mono -- analysis doesn't care about stereo. */
function toMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  if (channels === 1) return audioBuffer.getChannelData(0)

  const out = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c)
    for (let i = 0; i < length; i++) out[i] += data[i]
  }
  for (let i = 0; i < length; i++) out[i] /= channels
  return out
}

/**
 * Decoded audio -> SongMap. Shared by file loading and the demo track.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {string} name
 * @param {(stage:string, progress:number)=>void} onProgress
 */
export async function analyzeAudioBuffer(audioBuffer, name, onProgress = () => {}) {
  onProgress('analyzing', 0)
  const pcm = toMono(audioBuffer)

  const songMap = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress('analyzing', msg.progress)
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve(msg.songMap)
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message || 'Analysis worker crashed'))
    }

    // Copy the PCM so the transfer doesn't detach the buffer we still need
    // for playback.
    const copy = new Float32Array(pcm)
    worker.postMessage({ pcm: copy, sampleRate: audioBuffer.sampleRate }, [copy.buffer])
  })

  return { audioBuffer, songMap, name }
}

/**
 * File -> decoded audio + complete SongMap.
 *
 * @param {File} file
 * @param {AudioContext} audioContext
 * @param {(stage:string, progress:number)=>void} onProgress
 */
export async function loadSong(file, audioContext, onProgress = () => {}) {
  onProgress('reading', 0)
  const arrayBuffer = await file.arrayBuffer()

  onProgress('decoding', 0)
  // Throws on a corrupt file or a codec the browser can't handle.
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

  return analyzeAudioBuffer(audioBuffer, file.name.replace(/\.[^.]+$/, ''), onProgress)
}
