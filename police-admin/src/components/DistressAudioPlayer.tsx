import { useState } from 'react';
import { mediaUrl } from '../services/api';

interface DistressAudioPlayerProps {
  audioUrl: string;
  label?: string;
}

export function DistressAudioPlayer({ audioUrl, label = 'Recording' }: DistressAudioPlayerProps) {
  const [retry, setRetry] = useState(0);
  const src = `${mediaUrl(audioUrl)}${mediaUrl(audioUrl).includes('?') ? '&' : '?'}audioRetry=${retry}`;

  return (
    <div>
      <span className="map-incident-audio-label">{label}</span>
      <audio
        key={`${audioUrl}-${retry}`}
        className="distress-audio"
        controls
        preload="metadata"
        src={src}
        onError={() => setTimeout(() => setRetry((value) => value + 1), 500)}
      />
    </div>
  );
}
