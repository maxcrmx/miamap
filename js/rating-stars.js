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
// ouverture de formulaire) : les écouteurs mousemove/mouseup vivent sur
// `window` pour que le glisser continue même si le pointeur sort des
// étoiles, et les ré-attacher les accumulerait.
export function attachStarInput(container, onInput) {
  let dragging = false;
  const update = (clientX) => onInput(ratingFromPointer(container, clientX));

  container.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault(); // pas de sélection de texte pendant le glisser
    update(e.clientX);
  });
  window.addEventListener('mousemove', (e) => { if (dragging) update(e.clientX); });
  window.addEventListener('mouseup', () => { dragging = false; });

  container.addEventListener('touchstart', (e) => {
    dragging = true;
    update(e.touches[0].clientX);
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault(); // empêche la page de défiler pendant le réglage
    update(e.touches[0].clientX);
  }, { passive: false });
  container.addEventListener('touchend', () => { dragging = false; });
  container.addEventListener('touchcancel', () => { dragging = false; });
}
