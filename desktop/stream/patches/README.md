# Patches Social Stream Ninja

## Instagram Live (`ssn-instagram.js`)

Corrige la récupération des messages du chat Instagram Live dans l’app SSN installée.

### Problèmes corrigés

- `broadcast_id` souvent introuvable dans le DOM / l’URL → API REST jamais démarrée
- Après 3 échecs REST, abandon définitif sans rediscovery
- `last_comment_ts` trop agressif au démarrage
- Fallback DOM fragile (sélecteurs profil EN-only, rows hors `<section>`)

### Appliquer

```bash
node desktop/stream/patches/apply-ssn-instagram-patch.js
```

Puis redémarrer Social Stream Ninja.

Le hub peut aussi réappliquer automatiquement au lancement de SSN.
