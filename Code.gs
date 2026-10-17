/**
 * ════════════════════════════════════════════════════════════════════════════
 *  YOLICARDS — PILOTAGE TEST 14 JOURS
 *  Backend Apps Script : Web App (réception des formulaires) + planificateur
 *  (envoi automatique du post-test à J+14).
 *
 *  À coller dans l'éditeur Apps Script LIÉ au classeur PILOTAGE_TEST_14J
 *  (Extensions ▸ Apps Script depuis le classeur).
 *
 *  Déploiement : voir le fichier GUIDE_INSTALLATION.
 *  Fuseau de calcul des échéances : UTC (Abidjan, GMT+0).
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── PARAMÈTRES GÉNÉRAUX ──────────────────────────────────────────────────────
var DUREE_JOURS   = 14;                  // durée du test
var FUSEAU        = 'Etc/UTC';           // fuseau de calcul (UTC / Abidjan)
var EXPEDITEUR    = 'Équipe Yolicards';  // nom affiché dans les e-mails
// URL publique du formulaire post-test (page GitHub Pages). À renseigner dans
// l'onglet PARAMETRES (clé "url_posttest"), pas en dur ici.

// Noms des onglets (doivent correspondre exactement au classeur)
var T_TESTEURS  = 'TESTEURS';
var T_PRE       = 'PRE_TEST';
var T_SUIVI     = 'SUIVI_TEST';
var T_POST      = 'POST_TEST';
var T_PARAM     = 'PARAMETRES';

// ════════════════════════════════════════════════════════════════════════════
//  1. RÉCEPTION DES FORMULAIRES  (Web App — point d'entrée POST)
// ════════════════════════════════════════════════════════════════════════════
/**
 * Reçoit les envois des 3 surfaces web. Le corps JSON contient :
 *   { form: "pretest" | "suivi" | "posttest", code: "TEST-001", data: {...} }
 * Renvoie un JSON { ok: true } exploité par la page web.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // sérialise les écritures concurrentes
    var body = JSON.parse(e.postData.contents);
    var form = String(body.form || '').toLowerCase();
    var code = normCode_(body.code);
    var data = body.data || {};

    if (!code) return json_({ ok: false, error: 'code_testeur manquant' });

    var res;
    if (form === 'pretest')       res = recevoirPreTest_(code, data);
    else if (form === 'suivi')    res = recevoirSuivi_(code, data);
    else if (form === 'posttest') res = recevoirPostTest_(code, data);
    else return json_({ ok: false, error: 'form inconnu: ' + form });

    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Petit ping GET pour vérifier que le déploiement répond. */
function doGet(e) {
  return json_({ ok: true, service: 'Yolicards PILOTAGE_TEST_14J', time: now_() });
}

// ─── PRÉ-TEST : enregistre + démarre le chrono des 14 jours ───────────────────
function recevoirPreTest_(code, data) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(T_PRE);
  var debut = new Date();

  // Ligne de réponse pré-test : horodatage, code, e-mail, puis Q2..Q24 à plat.
  var ligne = [now_(), code, (data.email || '')].concat(aplatir_(data, 'pre'));
  sh.appendRow(ligne);

  // Registre central : enregistre début + échéance + statut, e-mail si fourni.
  var echeance = new Date(debut.getTime() + DUREE_JOURS * 24 * 3600 * 1000);
  majTesteur_(code, {
    email: data.email || '',
    date_debut: debut,
    date_echeance: echeance,
    statut_pretest: 'OK'
  });

  return { ok: true, echeance: Utilities.formatDate(echeance, FUSEAU, 'yyyy-MM-dd HH:mm') };
}

// ─── SUIVI 14 JOURS : chaque mise à jour = une ligne (historique) ─────────────
function recevoirSuivi_(code, data) {
  var sh = SpreadsheetApp.getActive().getSheetByName(T_SUIVI);
  // Horodatage, code, jour auto-déduit, missions cochées, journal, difficultés.
  var ligne = [
    now_(), code,
    jourDepuisDebut_(code),
    (data.missions_solo || ''),
    (data.mission_groupe || ''),
    (data.date_rencontre || ''),
    (data.nb_testeurs || ''),
    (data.journal || ''),
    (data.difficultes || '')
  ];
  sh.appendRow(ligne);
  majTesteur_(code, { statut_suivi: 'EN COURS' });
  return { ok: true };
}

// ─── POST-TEST : enregistre le bilan final ────────────────────────────────────
function recevoirPostTest_(code, data) {
  var sh = SpreadsheetApp.getActive().getSheetByName(T_POST);
  var ligne = [now_(), code].concat(aplatir_(data, 'post'));
  sh.appendRow(ligne);
  majTesteur_(code, {
    statut_posttest: 'OK',
    date_soumission_posttest: new Date()
  });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
//  2. PLANIFICATEUR  (déclencheur horaire — envoie le post-test à échéance)
// ════════════════════════════════════════════════════════════════════════════
/**
 * À brancher sur un déclencheur « horaire, toutes les heures » (voir guide).
 * Pour chaque testeur dont le pré-test est fait, dont l'échéance est atteinte
 * et dont le post-test n'a pas encore été envoyé : envoie le lien prérempli.
 */
function envoyerPostTestsEcheance() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(T_TESTEURS);
  var urlPost = getParam_('url_posttest');
  if (!urlPost) { Logger.log('url_posttest absent de PARAMETRES — abandon.'); return; }

  var rows = sh.getDataRange().getValues();
  var head = rows[0];
  var C = indexCols_(head);
  var maintenant = new Date();

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var code  = r[C.code_testeur];
    var email = r[C.email];
    if (!code || !email) continue;
    if (r[C.statut_pretest] !== 'OK') continue;       // pas encore démarré
    if (r[C.date_envoi_posttest]) continue;            // déjà envoyé
    var ech = r[C.date_echeance];
    if (!(ech instanceof Date)) continue;
    if (maintenant < ech) continue;                    // échéance pas atteinte

    try {
      var lien = urlPost + (urlPost.indexOf('?') === -1 ? '?' : '&') + 'code=' + encodeURIComponent(code);
      MailApp.sendEmail({
        to: email,
        name: EXPEDITEUR,
        subject: 'Yolicards — votre questionnaire final (14 jours de test)',
        htmlBody: corpsEmailPost_(lien, code)
      });
      sh.getRange(i + 1, C.date_envoi_posttest + 1).setValue(new Date());
      sh.getRange(i + 1, C.statut_posttest + 1).setValue('ENVOYÉ');
    } catch (err) {
      // Reprise sur erreur : on trace sans bloquer les autres ; réessai à l'heure suivante.
      sh.getRange(i + 1, C.statut_posttest + 1).setValue('ERREUR: ' + String(err).slice(0, 80));
      Logger.log('Échec envoi ' + code + ' : ' + err);
    }
  }
}

function corpsEmailPost_(lien, code) {
  return '' +
    '<div style="font-family:Arial,sans-serif;color:#1A1816;line-height:1.6;max-width:520px">' +
    '<p>Bonjour,</p>' +
    '<p>Vos <strong>14 jours de test Yolicards</strong> sont terminés — merci d\'y avoir participé !</p>' +
    '<p>Il reste une étape, la plus importante pour nous : le <strong>questionnaire final</strong> ' +
    '(environ 15 minutes). Votre avis franc, même critique, vaut de l\'or.</p>' +
    '<p style="text-align:center;margin:28px 0">' +
    '<a href="' + lien + '" style="background:#1A1816;color:#E9C46A;text-decoration:none;' +
    'padding:14px 26px;border-radius:10px;font-weight:bold;display:inline-block">Répondre au questionnaire final</a>' +
    '</p>' +
    '<p style="font-size:13px;color:#5F5A52">Votre code testeur <strong>' + code + '</strong> est déjà intégré au lien.</p>' +
    '<p style="font-size:13px;color:#5F5A52">L\'équipe Yolicards</p>' +
    '</div>';
}

// ════════════════════════════════════════════════════════════════════════════
//  3. OUTILS INTERNES
// ════════════════════════════════════════════════════════════════════════════
function majTesteur_(code, champs) {
  var sh = SpreadsheetApp.getActive().getSheetByName(T_TESTEURS);
  var rows = sh.getDataRange().getValues();
  var C = indexCols_(rows[0]);
  for (var i = 1; i < rows.length; i++) {
    if (normCode_(rows[i][C.code_testeur]) === code) {
      for (var k in champs) {
        if (C[k] === undefined) continue;
        var v = champs[k];
        // n'écrase pas un e-mail déjà présent par une valeur vide
        if (k === 'email' && !v && rows[i][C.email]) continue;
        sh.getRange(i + 1, C[k] + 1).setValue(v);
      }
      return true;
    }
  }
  // Code inconnu du registre : on l'ajoute pour ne perdre aucune donnée.
  var ligne = new Array(rows[0].length).fill('');
  ligne[C.code_testeur] = code;
  for (var k2 in champs) if (C[k2] !== undefined) ligne[C[k2]] = champs[k2];
  sh.appendRow(ligne);
  return false;
}

function jourDepuisDebut_(code) {
  var sh = SpreadsheetApp.getActive().getSheetByName(T_TESTEURS);
  var rows = sh.getDataRange().getValues();
  var C = indexCols_(rows[0]);
  for (var i = 1; i < rows.length; i++) {
    if (normCode_(rows[i][C.code_testeur]) === code) {
      var d = rows[i][C.date_debut];
      if (d instanceof Date) {
        var j = Math.floor((new Date() - d) / (24 * 3600 * 1000)) + 1;
        return 'J' + Math.max(1, Math.min(DUREE_JOURS, j));
      }
    }
  }
  return '';
}

function getParam_(cle) {
  var sh = SpreadsheetApp.getActive().getSheetByName(T_PARAM);
  if (!sh) return '';
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === cle) return String(rows[i][1]).trim();
  }
  return '';
}

/** Mappe les noms d'en-tête -> index de colonne (0-based). */
function indexCols_(head) {
  var C = {};
  for (var i = 0; i < head.length; i++) C[String(head[i]).trim()] = i;
  return C;
}

/** Aplatit data.q1..qN dans l'ordre numérique pour une ligne de réponse. */
function aplatir_(data, prefixe) {
  var keys = Object.keys(data).filter(function (k) { return /^q\d+$/.test(k); });
  keys.sort(function (a, b) { return parseInt(a.slice(1)) - parseInt(b.slice(1)); });
  return keys.map(function (k) {
    var v = data[k];
    return Array.isArray(v) ? v.join(' | ') : (v == null ? '' : v);
  });
}

function normCode_(c) { return String(c || '').trim().toUpperCase(); }
function now_()  { return Utilities.formatDate(new Date(), FUSEAU, 'yyyy-MM-dd HH:mm:ss'); }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════════════════════
//  4. INITIALISATION DU CLASSEUR  (à exécuter UNE SEULE FOIS)
//  Construit les 6 onglets, les en-têtes, les 30 codes, les formules et les
//  paramètres. Idempotent : ré-exécutable sans doublonner les en-têtes.
// ════════════════════════════════════════════════════════════════════════════
function initialiserClasseur() {
  var ss = SpreadsheetApp.getActive();

  // En-têtes alignés sur l'ordre d'écriture du backend (ne pas réordonner).
  var ENT_TESTEURS = ['code_testeur','email','date_debut','date_echeance',
    'statut_pretest','statut_suivi','statut_posttest','date_envoi_posttest','date_soumission_posttest'];

  var ENT_PRE = ['horodatage','code_testeur','email',
    'Q2 Groupe/grappe','Q3 Secteur','Q4 Ancienneté','Q5 Fréquence rencontres','Q6 Nb contacts/événement',
    'Q7 Usage carte papier','Q8 Avantages papier','Q9 Inconvénients papier','Q10 Situation vécue','Q11 Frustration (1-5)',
    'Q12 Connaissance NFC/QR','Q13 Avantages NFC','Q14 Inconvénients NFC','Q15 NFC règle-t-il le papier ?',
    'Q16 Modes de partage actuels','Q17 App déjà essayée','Q18 Défaut par solution',
    'Q19 3 attentes prioritaires','Q20 Ce qui ferait adopter','Q21 Ce qui ferait abandonner',
    'Q22 Promesses précieuses','Q23 Prêt à payer ?','Q24 Motivation à participer'];

  var ENT_SUIVI = ['horodatage','code_testeur','jour','missions_solo',
    'mission_groupe','date_rencontre','nb_testeurs','journal','difficultes'];

  var ENT_POST = ['horodatage','code_testeur',
    'Q3 Fréquence ouverture','Q4 Missions solo faites','Q5 Mission groupe faite','Q6 YoliZone — comment',
    'Q7 Satisfaction (1-5)','Q8 Fonction la plus convaincante','Q9 Ce qui a agacé','Q10 Failli abandonner',
    'Q11 Ce qui est compliqué','Q12 Facilité prise en main (1-5)',
    'Q13 Attentes satisfaites ?','Q14 Détail attente par attente','Q15 Problèmes papier résolus ?',
    'Q16 Apport vs NFC physique','Q17 Bonne surprise',
    'Q18 Payer PREMIUM 25 000 XOF ?','Q19 Ce qui ferait changer d\'avis','Q20 NPS (0-10)','Q21 À qui recommander',
    'Q22 Fonction à ajouter','Q23 À simplifier/supprimer','Q24 Suggestions en vrac','Q25 Recontact OK ?'];

  poserEntetes_(ss, T_TESTEURS, ENT_TESTEURS);
  poserEntetes_(ss, T_PRE, ENT_PRE);
  poserEntetes_(ss, T_SUIVI, ENT_SUIVI);
  poserEntetes_(ss, T_POST, ENT_POST);

  // 30 codes TEST-001..TEST-030 dans TESTEURS (sans écraser l'existant).
  var shT = ss.getSheetByName(T_TESTEURS);
  if (shT.getLastRow() < 2) {
    var codes = [];
    for (var i = 1; i <= 30; i++) codes.push([ 'TEST-' + ('00' + i).slice(-3) ]);
    shT.getRange(2, 1, 30, 1).setValues(codes);
  }
  shT.getRange('C:D').setNumberFormat('yyyy-mm-dd hh:mm');
  shT.getRange('H:I').setNumberFormat('yyyy-mm-dd hh:mm');
  shT.setFrozenRows(1);

  // PARAMETRES
  var shP = ss.getSheetByName(T_PARAM) || ss.insertSheet(T_PARAM);
  if (shP.getLastRow() < 1) {
    shP.getRange(1, 1, 6, 2).setValues([
      ['cle','valeur'],
      ['duree_jours', DUREE_JOURS],
      ['fuseau', FUSEAU],
      ['url_pretest', '(coller le lien pré-test GitHub Pages)'],
      ['url_suivi', '(coller le lien suivi GitHub Pages)'],
      ['url_posttest', '(coller le lien post-test GitHub Pages)']
    ]);
    shP.setColumnWidth(2, 420);
  }

  // SYNTHESE : une ligne par code, appariement attentes↔réalité et signaux clés.
  var shS = ss.getSheetByName('SYNTHESE') || ss.insertSheet('SYNTHESE');
  shS.clear();
  shS.getRange(1, 1, 1, 8).setValues([[
    'code_testeur','statut_pretest','statut_posttest',
    'Attente payer (pré, Q23)','Payer PREMIUM (post, Q18)','Satisfaction (post, Q7)','NPS (post, Q20)','Attentes satisfaites (post, Q13)'
  ]]);
  // formules tirées sur 30 lignes via RECHERCHEV sur le code
  var f = [];
  for (var r = 2; r <= 31; r++) {
    f.push([
      '=' + T_TESTEURS + '!A' + r,
      '=IFERROR(VLOOKUP($A' + r + ',' + T_TESTEURS + '!$A:$E,5,FALSE),"")',
      '=IFERROR(VLOOKUP($A' + r + ',' + T_TESTEURS + '!$A:$G,7,FALSE),"")',
      '=IFERROR(VLOOKUP($A' + r + ',' + T_PRE + "!$B:$Z,24,FALSE),\"\")",   // Q23 pré
      '=IFERROR(VLOOKUP($A' + r + ',' + T_POST + '!$B:$Z,17,FALSE),"")',    // Q18 post
      '=IFERROR(VLOOKUP($A' + r + ',' + T_POST + '!$B:$Z,6,FALSE),"")',     // Q7 post
      '=IFERROR(VLOOKUP($A' + r + ',' + T_POST + '!$B:$Z,19,FALSE),"")',    // Q20 post
      '=IFERROR(VLOOKUP($A' + r + ',' + T_POST + '!$B:$Z,12,FALSE),"")'     // Q13 post
    ]);
  }
  shS.getRange(2, 1, 30, 8).setFormulas(f);
  shS.setFrozenRows(1);

  SpreadsheetApp.getActive().toast('Classeur initialisé : 6 onglets, 30 codes, formules en place.', 'Yolicards', 8);
}

function poserEntetes_(ss, nom, entetes) {
  var sh = ss.getSheetByName(nom) || ss.insertSheet(nom);
  var besoin = sh.getLastRow() === 0;
  if (!besoin) {
    var cur = sh.getRange(1, 1, 1, entetes.length).getValues()[0];
    besoin = cur.join('\u0001') !== entetes.join('\u0001');
  }
  if (besoin) {
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes])
      .setFontWeight('bold').setBackground('#1A1816').setFontColor('#E9C46A');
    sh.setFrozenRows(1);
  }
  return sh;
}
