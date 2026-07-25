// ============================================================================
// settings.js — admin-only Settings screen: list readers (with revoke),
// and invite a new reader by email.
//
// "Invite" = insert a pending profiles row (role: reader, no user_id yet)
// then trigger Supabase's own magic link email for that address. See
// supabase/schema.sql for how the pending row gets linked to a real
// auth.users id the first time that person clicks the link.
// "Revoke" = flip is_active to false; RLS checks this live on every
// request, so it takes effect immediately (SPEC.md requirement).
// ============================================================================

import { sb } from './supabase-client.js';
import { escapeHtml } from './helpers.js';

const listEl = document.getElementById('settings-reader-list');
const inviteForm = document.getElementById('settings-invite-form');
const inviteEmailInput = document.getElementById('settings-invite-email');
const inviteStatus = document.getElementById('settings-invite-status');

export function initSettings() {
  inviteForm.addEventListener('submit', onInvite);
}

export async function openSettings() {
  document.getElementById('settings-screen').classList.add('open');
  await refreshReaderList();
}

export function closeSettings() {
  document.getElementById('settings-screen').classList.remove('open');
}

async function refreshReaderList() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, role, is_active, user_id')
    .eq('role', 'reader')
    .order('invited_at', { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="error-text">Erreur de chargement : ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data.length) {
    listEl.innerHTML = '<p class="muted">Aucun lecteur invité pour le moment.</p>';
    return;
  }

  listEl.innerHTML = '';
  for (const reader of data) {
    const row = document.createElement('div');
    row.className = 'reader-row';
    const statusLabel = !reader.is_active
      ? 'Révoqué'
      : reader.user_id
        ? 'Actif'
        : 'Invitation en attente';
    row.innerHTML = `
      <div class="reader-info">
        <span class="reader-email">${escapeHtml(reader.email)}</span>
        <span class="reader-status reader-status-${reader.is_active ? 'active' : 'revoked'}">${statusLabel}</span>
      </div>
      ${reader.is_active ? '<button class="btn-danger btn-small revoke-btn">Révoquer</button>' : ''}
    `;
    if (reader.is_active) {
      row.querySelector('.revoke-btn').addEventListener('click', () => revokeReader(reader.id));
    }
    listEl.appendChild(row);
  }
}

async function revokeReader(profileId) {
  if (!confirm("Révoquer l'accès de ce lecteur ?")) return;
  const { error } = await sb.from('profiles').update({ is_active: false }).eq('id', profileId);
  if (error) {
    alert("Erreur : " + error.message);
    return;
  }
  await refreshReaderList();
}

async function onInvite(e) {
  e.preventDefault();
  const email = inviteEmailInput.value.trim().toLowerCase();
  if (!email) return;

  inviteStatus.textContent = 'Invitation en cours...';

  // 1. Create (or reactivate) the pending profile row — this is what makes
  //    the bootstrap trigger in schema.sql accept this email on first login.
  const { error: upsertError } = await sb
    .from('profiles')
    .upsert({ email, role: 'reader', is_active: true }, { onConflict: 'email' });

  if (upsertError) {
    inviteStatus.textContent = 'Erreur : ' + upsertError.message;
    return;
  }

  // 2. Trigger Supabase's magic link email to that address.
  const redirectTo = window.location.origin + window.location.pathname;
  const { error: otpError } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });

  if (otpError) {
    inviteStatus.textContent = 'Profil créé mais erreur d\'envoi du lien : ' + otpError.message;
  } else {
    inviteStatus.textContent = `✓ Lien envoyé à ${email}.`;
    inviteEmailInput.value = '';
  }
  await refreshReaderList();
}
