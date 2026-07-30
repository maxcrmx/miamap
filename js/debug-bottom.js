// ============================================================================
// debug-bottom.js — PANNEAU DE DIAGNOSTIC TEMPORAIRE (session 14).
//
// POURQUOI CE FICHIER EXISTE
// Une bande d'une couleur différente persiste en bas d'écran sur le VRAI
// iPhone (carte, liste, fiche lieu, formulaire), alors que trois correctifs
// CSS successifs, tous validés en simulation locale (Chromium headless,
// getComputedStyle), n'ont rien changé sur l'appareil. Conclusion : la
// simulation ne voit pas ce que voit le téléphone. Ce panneau exécute les
// mêmes mesures DIRECTEMENT SUR LE TÉLÉPHONE et les affiche à l'écran, pour
// identifier la cause avec certitude avant d'écrire le moindre fix.
//
// COMMENT S'EN SERVIR (sur l'iPhone, app ouverte)
//   1. Toucher le bouton rond 🐞 (bord gauche de l'écran).
//   2. Le panneau s'affiche et se met à jour en continu. Deux lignes
//      repères apparaissent aussi :
//        - ligne ROUGE   = bord bas du viewport web (là où la page s'arrête)
//        - ligne MAGENTA = limite de la "safe area" iOS (env(safe-area-inset-bottom))
//      → si la bande incriminée est SOUS la ligne rouge, elle est HORS de la
//        page web : c'est iOS qui peint cette zone (fond html/body ou UI
//        système), pas un élément de l'app.
//      → si elle est AU-DESSUS, la section "QUI PEINT LE BAS ?" donne
//        l'élément exact et sa couleur.
//   3. Envoyer une capture d'écran du panneau (ou toucher 📋 Copier et
//      coller le texte) pour chacun des écrans concernés.
//
// SUPPRESSION UNE FOIS LE BUG RÉSOLU
//   - supprimer ce fichier (js/debug-bottom.js) ;
//   - supprimer la balise <script src="js/debug-bottom.js"></script> et son
//     commentaire dans index.html.
// Aucune autre trace : tout (styles compris) est contenu ici, rien n'est
// modifié dans le reste de l'app.
// ============================================================================

(function () {
  'use strict';

  // Estampille de version : si le panneau affiché sur le téléphone ne porte
  // PAS cette valeur (ou si le bouton 🐞 n'apparaît pas du tout), c'est que
  // l'app installée sert encore un vieux bundle en cache — une des causes
  // possibles du "rien ne change malgré les fixes" (l'écran d'accueil iOS
  // peut garder une copie périmée : supprimer l'icône et réinstaller).
  var VERSION = 'S14b-2026-07-30'; // b = ajout mesures metas iOS + canvas (fix bande)

  var Z = 2147483000; // au-dessus de tout le reste de l'app

  // --------------------------------------------------------------------------
  // Éléments du panneau (créés une fois, stylés en ligne — zéro CSS externe)
  // --------------------------------------------------------------------------
  var btn = document.createElement('button');
  btn.id = 'debug-bottom-btn';
  btn.textContent = '🐞';
  btn.setAttribute('aria-label', 'Panneau de diagnostic');
  btn.style.cssText =
    'position:fixed;left:10px;bottom:150px;width:42px;height:42px;' +
    'border-radius:50%;border:2px solid #900;background:#fff;font-size:20px;' +
    'z-index:' + Z + ';box-shadow:0 2px 8px rgba(0,0,0,.3);';

  var panel = document.createElement('div');
  panel.id = 'debug-bottom-panel';
  panel.style.cssText =
    'position:fixed;top:70px;left:8px;right:8px;max-height:52vh;display:none;' +
    'overflow-y:auto;background:rgba(15,15,15,.93);color:#8f8;padding:10px;' +
    'border-radius:10px;font:11px/1.5 ui-monospace,Menlo,monospace;' +
    'white-space:pre-wrap;z-index:' + Z + ';-webkit-overflow-scrolling:touch;';

  var copyBtn = document.createElement('button');
  copyBtn.textContent = '📋 Copier le rapport';
  copyBtn.style.cssText =
    'display:block;margin:0 0 8px;padding:6px 10px;border-radius:8px;' +
    'border:1px solid #8f8;background:none;color:#8f8;font:12px ui-monospace,monospace;';

  var report = document.createElement('div');
  panel.appendChild(copyBtn);
  panel.appendChild(report);

  // Ligne ROUGE : collée à bottom:0 du viewport web. Tout ce qui est visible
  // SOUS elle n'appartient pas à la page.
  var redLine = document.createElement('div');
  redLine.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;height:3px;background:red;' +
    'display:none;pointer-events:none;z-index:' + Z + ';';

  // Ligne MAGENTA : posée à env(safe-area-inset-bottom) du bas — la limite
  // au-dessus de laquelle iOS garantit que rien du système ne recouvre l'app.
  var magentaLine = document.createElement('div');
  magentaLine.style.cssText =
    'position:fixed;left:0;right:0;bottom:env(safe-area-inset-bottom, 0px);' +
    'height:3px;background:magenta;display:none;pointer-events:none;z-index:' + Z + ';';

  // Sonde invisible pour lire les valeurs réelles de env(safe-area-inset-*)
  // sur l'appareil (getComputedStyle sur un élément qui les porte en padding).
  var probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top, 0px);padding-right:env(safe-area-inset-right, 0px);' +
    'padding-bottom:env(safe-area-inset-bottom, 0px);padding-left:env(safe-area-inset-left, 0px);';

  // --------------------------------------------------------------------------
  // Collecte des mesures
  // --------------------------------------------------------------------------
  function bg(el) {
    return el ? getComputedStyle(el).backgroundColor : '(absent)';
  }

  // Décrit un élément-clé : fond calculé, où finit son bord bas par rapport
  // au bas du viewport (gap > 0 = il s'arrête AVANT le bas → quelque chose
  // d'autre est visible dessous), et s'il est actuellement affiché.
  function describe(label, el) {
    if (!el) return label + ' : (absent du DOM)';
    var cs = getComputedStyle(el);
    var hidden = cs.display === 'none' || el.classList.contains('hidden');
    var r = el.getBoundingClientRect();
    var gap = (window.innerHeight - r.bottom).toFixed(1);
    return label + ' : fond=' + cs.backgroundColor +
      (hidden ? ' [MASQUÉ]' : ' bordBas=' + r.bottom.toFixed(1) + ' écartBasViewport=' + gap + 'px');
  }

  // Pile des éléments présents à un point donné (du plus haut au plus bas) :
  // dit exactement QUI peint cette zone de l'écran et en quelle couleur.
  function stackAt(x, y) {
    var els;
    try { els = document.elementsFromPoint(x, y); } catch (e) { return '  (elementsFromPoint indisponible)'; }
    if (!els || !els.length) return '  (aucun élément — point hors viewport)';
    return els.slice(0, 5).map(function (el) {
      var name = el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        (el.classList.length ? '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.') : '');
      return '  ' + name + ' → fond=' + bg(el);
    }).join('\n');
  }

  // Contenu réel d'une balise <meta name=...> telle qu'elle est dans le DOM
  // (donc telle qu'iOS l'a lue) — '(absente)' si elle n'existe pas.
  function metaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? '"' + el.getAttribute('content') + '"' : '(absente)';
  }

  function buildReport() {
    var w = window.innerWidth, h = window.innerHeight;
    var cs = getComputedStyle(probe);
    var standalone = (navigator.standalone === true) ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    var vv = window.visualViewport;

    // La "bande" : zone entre le bas du layout viewport (h) et le bas
    // physique de l'écran — peinte par le canvas (fond de <html>), hors de
    // portée de tout élément positionné. Voir le commentaire dans style.css.
    var stripHeight = screen.height - h;
    var canvasColor = getComputedStyle(document.documentElement).backgroundColor;
    var formOpen = !!document.querySelector('#place-form-screen.open');
    var sheetOpen = !!document.querySelector('#place-sheet.open');

    var lines = [
      'MIAMAP — DIAGNOSTIC BAS D\'ÉCRAN  [' + VERSION + ']',
      'page chargée le : ' + document.lastModified,
      '',
      '--- CONTEXTE ---',
      'mode app installée (standalone) : ' + standalone +
        '  (navigator.standalone=' + navigator.standalone + ')',
      'navigateur : ' + navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 80),
      '',
      '--- DIMENSIONS (px CSS) ---',
      'viewport web (innerW×innerH) : ' + w + ' × ' + h,
      'écran physique (screen)      : ' + screen.width + ' × ' + screen.height + '  (dpr ' + devicePixelRatio + ')',
      '→ si innerH < screen.height : la page NE descend PAS jusqu\'au bord bas,',
      '  la bande sous la ligne ROUGE est peinte par iOS (fond html/body).',
      'visualViewport.height : ' + (vv ? vv.height.toFixed(1) : '(non supporté)') +
        (vv ? '  offsetTop=' + vv.offsetTop : ''),
      'unité dvh supportée : ' + (window.CSS && CSS.supports ? CSS.supports('height', '100dvh') : '?'),
      '',
      '--- SAFE AREA RÉELLE (env, lue sur l\'appareil) ---',
      'top=' + cs.paddingTop + '  right=' + cs.paddingRight +
        '  bottom=' + cs.paddingBottom + '  left=' + cs.paddingLeft,
      '→ bottom=0px sur un iPhone à encoche = viewport-fit=cover inactif.',
      '',
      '--- MÉTAS iOS (telles que présentes dans le DOM) ---',
      'apple-mobile-web-app-status-bar-style : ' + metaContent('apple-mobile-web-app-status-bar-style'),
      'apple-mobile-web-app-capable          : ' + metaContent('apple-mobile-web-app-capable'),
      'viewport : ' + metaContent('viewport'),
      '',
      '--- LA BANDE (zone hors layout viewport, peinte par le canvas) ---',
      'hauteur : screen(' + screen.height + ') − innerH(' + h + ') = ' + stripHeight + 'px',
      'couleur ACTUELLE du canvas (fond de <html>) : ' + canvasColor,
      'déclencheurs du fix : formulaire ouvert=' + formOpen + '  fiche ouverte=' + sheetOpen,
      '→ attendu : rgb(251, 248, 241) [crème] si formulaire OU fiche ouvert,',
      '            rgb(243, 238, 227) [beige] sinon (carte/liste/réglages).',
      '→ si la couleur ne bascule pas alors qu\'un des deux est "true",',
      '  le sélecteur html:has(...) n\'est pas appliqué sur cet appareil.',
      '',
      '--- FONDS CALCULÉS (live) ---',
      describe('html            ', document.documentElement),
      describe('body            ', document.body),
      describe('#main-screen    ', document.getElementById('main-screen')),
      describe('#place-form-scr ', document.getElementById('place-form-screen')),
      describe('#settings-screen', document.getElementById('settings-screen')),
      describe('.bottom-sheet   ', document.querySelector('.bottom-sheet')),
      describe('.bottom-bar     ', document.querySelector('.bottom-bar')),
      describe('.form-body      ', document.querySelector('.form-body')),
      '',
      '--- QUI PEINT LE BAS ? (pile d\'éléments, du dessus au dessous) ---',
      'au point (' + Math.round(w / 2) + ', ' + (h - 2) + ') — 2px au-dessus du bord :',
      stackAt(w / 2, h - 2),
      'au point (' + Math.round(w / 2) + ', ' + (h - 40) + ') — 40px au-dessus :',
      stackAt(w / 2, h - 40),
      '',
      '--- REPÈRES VISUELS ---',
      'ligne ROUGE   = bord bas du viewport web',
      'ligne MAGENTA = limite safe-area iOS (' + cs.paddingBottom + ' au-dessus du bord)',
      'La bande à diagnostiquer est-elle AU-DESSUS ou EN-DESSOUS de la ROUGE ?',
    ];
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // Interactions
  // --------------------------------------------------------------------------
  var timer = null;

  function refresh() { report.textContent = buildReport(); }

  btn.addEventListener('click', function () {
    var open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    redLine.style.display = open ? 'block' : 'none';
    magentaLine.style.display = open ? 'block' : 'none';
    if (open) {
      refresh();
      timer = setInterval(refresh, 1000); // mesures live (rotation, clavier, etc.)
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  copyBtn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report.textContent).then(function () {
        copyBtn.textContent = '✅ Copié !';
        setTimeout(function () { copyBtn.textContent = '📋 Copier le rapport'; }, 1500);
      }, function () { copyBtn.textContent = '❌ Copie refusée (capture d\'écran alors)'; });
    } else {
      copyBtn.textContent = '❌ Presse-papier indisponible (capture d\'écran alors)';
    }
  });

  // try/catch global : un panneau de debug ne doit JAMAIS pouvoir casser
  // l'app elle-même, quoi qu'il arrive.
  try {
    document.body.appendChild(probe);
    document.body.appendChild(redLine);
    document.body.appendChild(magentaLine);
    document.body.appendChild(panel);
    document.body.appendChild(btn);
  } catch (e) { /* silencieux : tant pis pour le debug, l'app continue */ }
})();
