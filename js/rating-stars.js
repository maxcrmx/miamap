// ============================================================================
// rating-stars.js — le widget de notation 5 étoiles, partagé entre la fiche
// lieu (affichage) et le formulaire (saisie).
//
// Une note est TOUJOURS un nombre de 0 à 5 par pas de 0,5 — jamais du texte.
// `null` signifie "pas encore noté" (lieu à tester), ce qui est différent de
// 0 ("testé et noté zéro").
//
// Saisie (formulaire) : cliquer la moitié GAUCHE d'une étoile donne la
// demi-note (moitié gauche de la 3e = 2,5), la moitié DROITE donne la note
// entière (3e étoile pleine = 3). Le glisser (souris ou doigt) ajuste la
// note en continu sans avoir à viser étoile par étoile.
// ============================================================================

// Les 5 boutons-étoiles pour une note donnée : pleine, à moitié, ou vide.
// Rendu séparé du conteneur pour pouvoir redessiner les étoiles sans
// détruire le conteneur (qui porte les écouteurs de glisser).
export function starButtonsHtml(rating) {
  const r = rating ?? 0;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const cls = r >= i ? ' full' : r >= i - 0.5 ? ' half' : '';
    html += `<button type="button" class="star${cls}" data-value="${i}" aria-label="${i} étoiles">★</button>`;
  }
  return html;
}

// Le widget complet, conteneur inclus (utilisé par la fiche lieu).
export function starsHtml(rating, { editable = false } = {}) {
  return `<div class="stars${editable ? '' : ' readonly'}">${starButtonsHtml(rating)}</div>`;
}

// Met à jour les classes full/half des 5 boutons DÉJÀ PRÉSENTS dans
// `container`, sans toucher au DOM (pas de innerHTML). À utiliser pour
// toute mise à jour pendant/après un glisser — voir attachStarInput pour
// pourquoi remplacer les boutons à ce moment-là casse le tactile sur iOS.
export function updateStarButtons(container, rating) {
  const r = rating ?? 0;
  const buttons = container.querySelectorAll('.star');
  buttons.forEach((btn, idx) => {
    const i = idx + 1;
    btn.classList.remove('full', 'half');
    if (r >= i) btn.classList.add('full');
    else if (r >= i - 0.5) btn.classList.add('half');
  });
}

// Convertit une position horizontale de pointeur en note 0–5 par pas de 0,5.
// Chaque étoile occupe 1/5 de la largeur ; l'arrondi au demi-point SUPÉRIEUR
// est ce qui produit "moitié gauche → demi-note, moitié droite → entière".
export function ratingFromPointer(container, clientX) {
  const rect = container.getBoundingClientRect();
  if (!rect.width) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  const rating = Math.ceil(ratio * 5 * 2) / 2;
  return Math.min(5, Math.max(0, rating));
}

// Rend `container` interactif : clic ET glisser (souris + tactile) appellent
// `onInput(note)` à chaque changement.
//
// À n'appeler qu'UNE fois par conteneur (à l'initialisation, pas à chaque
// ouverture de formulaire) : voir plus bas pourquoi les ré-attacher les
// accumulerait.
//
// Les écouteurs mousemove/mouseup ne vivent sur `window` QUE pendant un
// glisser en cours (attachés au mousedown, retirés au mouseup) — jamais en
// permanence. Un ancien bug les gardait attachés en continu, gatés par un
// simple booléen `dragging` : si ce booléen restait bloqué à `true` (ex. un
// `mouseup`/`touchend` manqué, fréquent sur iOS avec les événements souris
// "fantômes" émis après un tactile), TOUT mousemove suivant sur la page —
// y compris ceux précédant un tap sur un tout autre champ — recalculait la
// note et volait l'interaction. Ici, tant qu'aucun glisser n'est en cours,
// aucun écouteur global n'existe : rien à voler.
export function attachStarInput(container, onInput) {
  const update = (clientX) => onInput(ratingFromPointer(container, clientX));

  function onMouseMove(e) { update(e.clientX); }
  function stopDrag() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDrag);
    window.removeEventListener('blur', stopDrag);
  }

  container.addEventListener('mousedown', (e) => {
    e.preventDefault(); // pas de sélection de texte pendant le glisser
    update(e.clientX);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    // Filet de sécurité : si la page perd le focus en plein glisser (ex.
    // bascule d'appli), on retire quand même les écouteurs plutôt que de
    // les laisser vivre jusqu'au prochain mouseup qui n'arrivera peut-être
    // jamais.
    window.addEventListener('blur', stopDrag);
  });

  // Le tactile n'a pas besoin de ce ballet : touchstart/touchmove sont posés
  // sur `container` lui-même (jamais sur `window`), donc les ÉCOUTEURS ne
  // fuient jamais en dehors des étoiles.
  //
  // MAIS il y avait un second bug, propre au tactile, plus grave que le
  // premier : chaque appel à `update()` pendant un glisser déclenchait (côté
  // appelant, voir setRating dans place-form.js) un `container.innerHTML =
  // ...` qui DÉTRUISAIT ET RECRÉAIT le bouton-étoile sous le doigt, EN PLEIN
  // GESTE TACTILE EN COURS. Sur iOS Safari (et particulièrement en PWA
  // standalone), muter le sous-arbre DOM ciblé par un touchmove en cours
  // peut corrompre le dispatcher tactile natif : les taps suivants, sur
  // N'IMPORTE QUEL élément de la page, restent alors "capturés" par
  // l'ancien geste jusqu'à fermeture forcée de l'app — exactement le
  // symptôme observé. La correction est côté appelant : ne plus jamais
  // faire de innerHTML pendant un glisser, seulement `updateStarButtons`
  // (classes togglées sur des boutons existants, aucune mutation de
  // structure DOM).
  container.addEventListener('touchstart', (e) => {
    update(e.touches[0].clientX);
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    e.preventDefault(); // empêche la page de défiler pendant le réglage
    update(e.touches[0].clientX);
  }, { passive: false });
}
