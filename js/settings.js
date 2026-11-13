// ============================================================================
// settings.js — écran Réglages (admin uniquement, roue crantée en bas à droite).
//
// Il ne contient plus que le bouton « Se déconnecter » (câblé dans app.js).
// La gestion des lecteurs (invitation par e-mail, révocation) a été retirée
// avec le magic link : l'app n'a désormais qu'un seul utilisateur, l'admin,
// qui se connecte avec son code à 4 chiffres (voir js/auth.js).
// ============================================================================

export function openSettings() {
  document.getElementById('settings-screen').classList.add('open');
}

export function closeSettings() {
  document.getElementById('settings-screen').classList.remove('open');
}
