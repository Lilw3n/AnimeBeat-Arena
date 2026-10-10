# AnimeBeat Stream Command

Hub local : **Social Stream Ninja** (chat) · **Streamer.bot** (titres/jeux) · **OBS dashboard** · **multistream**.

## Lancer

```bash
cd desktop
npm start
```

Stream Command = bouton toolbar ou `Ctrl+S`. Chat hub = mode **Chat SSN**.

## Architecture

| Besoin | Outil | Intégration hub |
|--------|--------|-----------------|
| Chat multi-plateformes | [Social Stream Ninja](https://github.com/steveseguin/social_stream) | Dock embarqué + WS `io.socialstream.ninja` |
| Titres / jeux / actions | [Streamer.bot](https://streamer.bot) | WebSocket `DoAction` avec `%title%` / `%game%` |
| Scènes, textes, RTMP | OBS WebSocket | Dashboard dans Stream Command |
| Multilive | Relais RTMP local | OBS → hub → Twitch/Kick/FB/IG/YT |
| TikTok | TikTok LIVE Studio | Toujours en parallèle (externe) |

### Flux horizontal / vertical (Stream Command → Flux H/V)

| Orientation | Défaut (recommandé) | Alternative |
|-------------|---------------------|-------------|
| **Horizontal** | OBS Restream (`streamDestinationMode=leave`) | nginx `:1935` + `nginx.conf` push |
| **Vertical (IG)** | Aitum Vertical Streaming (`igVia=aitum`) | nginx + stunnel `:19351` (`igVia=nginx`) |

Ne pas passer en nginx H sauf besoin Meta via stunnel sans Restream. Les défauts ne cassent pas le Go Live actuel.

Sources de référence clonées : `../vendor/social_stream`, `../vendor/Streamer.bot`, `../vendor/obs-studio`.

## Setup Social Stream Ninja

1. Installe SSN (extension ou app).
2. Active **Enable remote API control** + **Send chat messages to API server**.
3. Copie le **session ID** (dock URL `?session=`).
4. Stream Command → section SSN → colle l’ID → Connecter.
5. Toolbar chat → **Chat SSN**.

## Setup Streamer.bot

1. Streamer.bot → **Servers → WebSocket Server** ON (port `8080`).
2. Crée une action `AnimeBeat Set Title` : sub-action **Set Channel Title** = `%title%`.
3. Crée `AnimeBeat Set Game` : **Set Channel Game** = `%game%`.
4. (Optionnel) une action combinée renseignée dans `setTitleAndGame`.
5. Stream Command → Connecter Streamer.bot.

« Appliquer titre + jeu » envoie aussi vers Streamer.bot + textes OBS + Twitch Helix (si tokens).

## Dashboard OBS

- Host / password WebSocket  
- Mapping sources texte titre/jeu  
- Scènes pour 1–10 écrans hub  
- Liste scènes live + switch  
- Ingest multilive local  

## Config fichier

`%APPDATA%/animebeat-live-hub/stream-command.json`
