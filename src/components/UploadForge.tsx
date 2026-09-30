interface UploadForgeProps {
  hasAudio: boolean
  onFile(file: File): void
}

export function UploadForge({ hasAudio, onFile }: UploadForgeProps) {
  return (
    <section className={`forge-panel riveted ${hasAudio ? 'loaded' : ''}`}>
      <div className="forge-copy">
        <p className="eyebrow">TURN NOISE INTO NOTEFIRE</p>
        <h1>LOAD IT. READ IT. <em>SHRED IT.</em></h1>
        <p>
          Drop a recording into the local forge. SHRED reads its pulse, builds four playable
          interpretations, and drives the preview straight from the audio clock.
        </p>
      </div>
      <label className="drop-zone">
        <input
          id="audio-file"
          name="audio-file"
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.webm"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.target.value = ''
          }}
        />
        <span className="pick-icon">ϟ</span>
        <strong>{hasAudio ? 'SWAP THE TRACK' : 'FEED THE FORGE'}</strong>
        <small>MP3 · WAV · OGG · M4A · AAC · FLAC · WEBM</small>
      </label>
    </section>
  )
}
