import { useRef, useState } from 'react';
import { api } from '../api/client';

interface Props {
  value: string | null;
  onChange: (url: string, mediaType: 'photo' | 'video') => void;
  accept?: string;
  label?: string;
}

export default function PhotoUpload({ value, onChange, accept = 'image/*,video/*', label = 'Прикрепить фото или видео' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload<{ url: string; mediaType: 'photo' | 'video' }>('/progress/upload', file);
      onChange(res.url, res.mediaType);
    } catch (e: any) {
      setError('Не удалось загрузить файл');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? 'Загрузка…' : value ? 'Заменить файл' : label}
      </button>
      {error && <div className="error-text">{error}</div>}
      {value && (value.match(/\.(mp4|mov|webm)$/i) ? (
        <video className="preview" src={value} controls />
      ) : (
        <img className="preview" src={value} alt="preview" />
      ))}
    </div>
  );
}
