# MRS Produktion – version simple

Deux fichiers principaux :
- `server.js` : le serveur (SQL Server + API + assistant Claude)
- `App.jsx`   : toute l'interface (React + Ant Design)

## Installation (une seule fois)
1. Copier `.env.beispiel` en `.env` et remplir les accès à la base.
2. `npm install`
3. `npm run build`   (crée le dossier `dist` avec l'interface)

## Démarrer
`npm start`  → http://localhost:3000

## Après une modification de App.jsx
Relancer `npm run build`, puis `npm start`.
(Pour voir les changements en direct : `npm start` dans un terminal et `npm run dev` dans un autre → http://localhost:5173)
