import { useEffect, useRef, useState } from 'react';
import { getAuthToken, mediaUrl } from '../services/api';

interface DistressAudioPlayerProps {
  audioUrl: string;
  label?: string;
}

export function DistressAudioPlayer({ audioUrl, label = 'Recording' }: DistressAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const load = async () => {
      setError(false);
      try {
        const token = getAuthToken();
        const separator = audioUrl.includes('?') ? '&' : '?';
        const res = await fetch(`${mediaUrl(audioUrl)}${separator}v=${encodeURIComponent(audioUrl)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('load failed');
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setError(true);
          setSrc(mediaUrl(audioUrl));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [audioUrl]);

  if (error) {
    return (
      <a href={mediaUrl(audioUrl)} target="_blank" rel="noreferrer" className="map-incident-audio">
        Open recording
      </a>
    );
  }

  if (!src) {
    return <span className="map-incident-audio-loading">Loading audio…</span>;
  }

  return (
    <div>
      <span className="map-incident-audio-label">{label}</span>
    <audio ref={audioRef} className="distress-audio" controls preload="metadata" src={src}>
      <a href={mediaUrl(audioUrl)} target="_blank" rel="noreferrer">Open recording</a>
    </audio>
    </div>
  );
}
