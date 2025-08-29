# Spotify Playlist Analyzer

**Spotify Playlist Analyzer** — istifadəçinin Spotify hesabına qoşularaq playlistləri götürür, hər bir playlist üçün dərin analiz edir (top artistlər, top tracklər, ümumi müddət, orta audio-features: danceability, energy, tempo, valence və s.) və nəticələri vizuallaşdırır.

> Bu layihə **Spotify Web API** istifadə edir və OAuth (Authorization Code) axını ilə token əldə edir.

## Xüsusiyyətlər
- Spotify hesab ilə giriş (OAuth)
- İstifadəçinin playlistlərini seçmək
- Playlist üçün:
  - Ümumi track sayı və müddət
  - Top artistlər (say üzrə)
  - Top tracklər (populyarlığa görə)
  - Ortalama audio features (danceability, energy, tempo, valence)
  - Chart.js ilə vizuallaşdırma
- Backend token yeniləmə (refresh token)
- Best-practices: secret `.env` faylı, session
