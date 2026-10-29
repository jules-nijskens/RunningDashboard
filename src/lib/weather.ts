import type { WeatherInfo } from '@/types/run';

/** Maps a WMO weather code (Open-Meteo) to an emoji. */
export function weatherEmoji(code?: number): string {
  if (code === undefined || code === null) return '🌡️';
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function weatherSummary(w: WeatherInfo): string {
  return `${w.tempAvg}°C (${w.tempMin}–${w.tempMax}°), Humidity ${w.humidityAvg}%, Rain ${w.rainMm}mm, Wind ${w.windAvg}km/h`;
}
