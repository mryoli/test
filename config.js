/* ───────────────────────────────────────────────────────────────────────────
   YOLICARDS — Configuration du parcours de test
   Une seule valeur à renseigner avant publication : l'URL de la Web App
   Apps Script (déploiement ▸ « Application Web »). Voir GUIDE_INSTALLATION.
   Tant qu'elle vaut "", les formulaires fonctionnent en mode démonstration
   (rien n'est envoyé ; la réponse est seulement affichée).
─────────────────────────────────────────────────────────────────────────── */
window.YOLI_CONFIG = {
  WEBAPP_URL: "https://script.google.com/macros/s/AKfycbylc1KsD-x0ydYv9A7-Vt1Ai7t_zeeR0672uddU1f60TUv6KAa-_4Ohrj7wBm3J2d9QVw/exec",
  PREMIUM_PRIX: "25 000 XOF",
  DUREE_JOURS: 14,
  // Liens de téléchargement de l'app — à renseigner quand la distribution est prête.
  // Tant qu'ils sont vides, la page affiche un message d'attente (sans date).
  URL_ANDROID: "",   // ex : lien APK, ou page Play Store / test interne
  URL_IOS: ""        // ex : lien TestFlight
};
