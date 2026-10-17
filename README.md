# Yolicards — Parcours de test 14 jours

Dispositif complet : 3 surfaces web (pré-test, suivi, post-test) + backend Google
(Sheet `PILOTAGE_TEST_14J` + Apps Script). Tout tourne sous ton compte Google et ta
page GitHub Pages. Aucun hébergement payant, pas de Tally.

## Fichiers

| Fichier            | Rôle                                                        |
|--------------------|-------------------------------------------------------------|
| `index.html`       | Page d'accueil (liens vers les 3 étapes)                    |
| `pre-test.html`    | Formulaire pré-test (24 Q + e-mail), avant installation     |
| `suivi.html`       | Fiche de mission 14 j — checklist **persistante**           |
| `post-test.html`   | Questionnaire final (25 Q), après 14 jours                  |
| `form-engine.js`   | Moteur commun pré-test / post-test                          |
| `styles.css`       | Identité visuelle Yolicards (ink / or)                      |
| `config.js`        | **La seule ligne à éditer** : `WEBAPP_URL`                  |
| `Code.gs`          | À coller dans l'éditeur Apps Script du classeur             |

## Les 2 seuls gestes manuels

1. **Google** — Ouvre le classeur `PILOTAGE_TEST_14J`, colle `Code.gs` dans
   Extensions ▸ Apps Script, exécute `initialiserClasseur()` une fois, déploie en
   « Application Web » (autorise l'envoi d'e-mail), crée un déclencheur horaire sur
   `envoyerPostTestsEcheance`. Copie l'URL de la Web App.
2. **GitHub** — Dépose ces fichiers sur ta page GitHub Pages, après avoir collé
   l'URL de la Web App dans `config.js` (`WEBAPP_URL`) et les 3 liens publics dans
   l'onglet `PARAMETRES` du classeur.

Détail pas-à-pas : voir le guide Word fourni (`GUIDE_INSTALLATION`).

## Liens individuels des testeurs

`.../pre-test.html?code=TEST-001` … `?code=TEST-030` (le code se verrouille et
s'enregistre tout seul). Le post-test est envoyé automatiquement par e-mail à J+14.

## Mode démonstration

Tant que `WEBAPP_URL` vaut `""`, les formulaires marchent mais n'envoient rien
(réponse affichée en console) — pratique pour tester l'affichage avant branchement.
