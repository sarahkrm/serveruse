// ========== CONFIGURATION ==========
const CLIENT_ID = '76344759755-4vqk106qsrrq6ci9280vlpij9rlsiukf.apps.googleusercontent.com';
const SPREADSHEET_ID = '1mimuV3A7LTBnH5q2iK6_AJqYAj3NHG67PWAwNUBRb7g';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';
const POLL_INTERVAL = 10000;

// ========== VARIABLES GLOBALES ==========
const timers = {};
const utilisations = {};
let isSignedIn = false;
let tokenClient = null;
let currentUserName = '';
let pollTimer = null;
let etatCores = {
  'cores 0-23':  { statut: 'libre', utilisateur: '', debut: '' },
  'cores 24-47': { statut: 'libre', utilisateur: '', debut: '' },
  'cores 48-71': { statut: 'libre', utilisateur: '', debut: '' },
  'cores 72-95': { statut: 'libre', utilisateur: '', debut: '' },
};

// ========== INITIALISATION ==========
document.addEventListener('DOMContentLoaded', () => {

  gapi.load('client', async () => {
    await gapi.client.init({
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4']
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
  client_id: CLIENT_ID,
  scope: SCOPES,
  callback: async (response) => {
    if (response.error) {
      console.error('Erreur auth:', response);
      return;
    }

    // On attend que le token soit bien enregistré
    gapi.client.setToken(response);

    isSignedIn = true;
    await updateAuthStatus(true);
    await syncEtat();
    pollTimer = setInterval(syncEtat, POLL_INTERVAL);
  }
});
  });

  document.getElementById('authorize-button').addEventListener('click', () => {
    tokenClient.requestAccessToken();
  });

  document.getElementById('signout-button').addEventListener('click', () => {
    google.accounts.oauth2.revoke(gapi.client.getToken().access_token, () => {
      gapi.client.setToken(null);
      isSignedIn = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      updateAuthStatus(false);
    });
  });

  setupEventListeners();
});

// ========== AUTHENTIFICATION ==========
async function updateAuthStatus(signedIn) {
  isSignedIn = signedIn;
  const authorizeButton = document.getElementById('authorize-button');
  const signoutButton = document.getElementById('signout-button');
  const userInfo = document.getElementById('user-info');

  if (signedIn) {
    authorizeButton.classList.add('hidden');
    signoutButton.classList.remove('hidden');
    userInfo.classList.remove('hidden');

    // Décode le JWT directement sans fetch
    try {
      const token = gapi.client.getToken();
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const profile = await response.json();
      console.log('Profil reçu:', profile);
      currentUserName = profile.name || profile.email || 'Utilisateur';
    } catch (e) {
      // Fallback : utilise le champ userName saisi manuellement
      console.warn('Impossible de récupérer le profil, utilise le nom manuel');
      currentUserName = document.getElementById('userName').value || 'Utilisateur';
    }

    userInfo.textContent = `Connecté en tant que : ${currentUserName}`;
    document.getElementById('userName').value = currentUserName;

  } else {
    authorizeButton.classList.remove('hidden');
    signoutButton.classList.add('hidden');
    userInfo.classList.add('hidden');
    userInfo.textContent = '';
    currentUserName = '';
    document.getElementById('userName').value = '';
    Object.keys(timers).forEach(cores => clearTimer(cores));
  }
}

// ========== POLLING ET SYNCHRONISATION ==========
async function syncEtat() {
  if (!isSignedIn) return;

  const token = gapi.client.getToken();
  if (!token) {
    isSignedIn = false;
    updateAuthStatus(false);
    return;
  }

  // Si le token expire dans moins de 10 minutes, prévient l'utilisateur
  const expiresInMs = token.expires_at - Date.now();
  if (expiresInMs < 10 * 60 * 1000) {
    const continuer = confirm('Votre session expire bientôt. Cliquez OK pour rester connecté.');
    if (continuer) {
      // L'utilisateur clique OK = geste utilisateur = popup autorisé
      tokenClient.requestAccessToken({ prompt: '' });
      return;
    }
  }

  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Etat!A2:D5'
    });

    const rows = response.result.values || [];
    rows.forEach(row => {
      const cores = row[0];
      const statut = row[1] || 'libre';
      const utilisateur = row[2] || '';
      const debut = row[3] || '';
      etatCores[cores] = { statut, utilisateur, debut };
      updateCoreUI(cores, statut, utilisateur, debut);
    });

  } catch (error) {
    console.error('Erreur polling :', error);
  }
}

// Met à jour l'affichage d'une catégorie selon son état
function updateCoreUI(cores, statut, utilisateur, debut) {
  const checkbox = document.querySelector(`.utilise-checkbox[data-cores="${cores}"]`);
  const timerElement = document.querySelector(`.timer[data-cores="${cores}"]`);
  const userInputDiv = document.querySelector(`.user-input[data-cores="${cores}"]`);
  let finirBtn = document.querySelector(`.finir-btn[data-cores="${cores}"]`);

  if (statut === 'occupé') {
    checkbox.checked = true;
    checkbox.disabled = true;

    if (!timers[cores] && debut) {
      startTimerDepuis(cores, new Date(debut));
    }

    if (utilisateur === currentUserName) {
      userInputDiv.classList.add('hidden');
      if (!finirBtn) {
        finirBtn = document.createElement('button');
        finirBtn.textContent = 'Finir';
        finirBtn.classList.add('finir-btn', 'finir-btn-style');
        finirBtn.setAttribute('data-cores', cores);
        finirBtn.addEventListener('click', () => libererCores(cores));
        timerElement.insertAdjacentElement('afterend', finirBtn);
      }
    }

    timerElement.style.color = '#e74c3c';

  } else {
    checkbox.checked = false;
    checkbox.disabled = false;
    clearTimer(cores);
    timerElement.style.color = '#2c3e50';
    if (finirBtn) finirBtn.remove();
    userInputDiv.classList.add('hidden');
  }
}

// ========== TIMERS ==========
function startTimerDepuis(cores, startTime) {
  clearTimer(cores);
  const timerElement = document.querySelector(`.timer[data-cores="${cores}"]`);

  timers[cores] = setInterval(() => {
    const elapsed = new Date() - startTime;
    const seconds = Math.floor(elapsed / 1000) % 60;
    const minutes = Math.floor(elapsed / (1000 * 60)) % 60;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    timerElement.textContent = `Temps : ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, 1000);

  utilisations[cores] = { userName: currentUserName, startTime };
}

function clearTimer(cores) {
  if (timers[cores]) {
    clearInterval(timers[cores]);
    delete timers[cores];
  }
  if (utilisations[cores]) {
    delete utilisations[cores];
  }
  const timerElement = document.querySelector(`.timer[data-cores="${cores}"]`);
  if (timerElement) timerElement.textContent = 'Temps : 00:00:00';
}

// ========== ÉCOUTEURS D'ÉVÉNEMENTS ==========
function setupEventListeners() {

  document.querySelectorAll('.utilise-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      if (!isSignedIn) {
        alert('Veuillez vous connecter avec Google pour utiliser cette fonctionnalité.');
        e.target.checked = false;
        return;
      }
      const cores = e.target.getAttribute('data-cores');

      if (e.target.checked) {
        // Vérifie que personne d'autre n'utilise déjà (double sécurité)
        await syncEtat();
        if (etatCores[cores].statut === 'occupé') {
          alert(`${cores} est déjà utilisé par ${etatCores[cores].utilisateur}.`);
          e.target.checked = false;
          return;
        }
        // Affiche le formulaire nom
        const userInputDiv = document.querySelector(`.user-input[data-cores="${cores}"]`);
        userInputDiv.classList.remove('hidden');
        userInputDiv.querySelector('.user-name-input').value = currentUserName;
      } else {
        // Décochage manuel ignoré si occupé par soi-même (on utilise le bouton Finir)
        if (etatCores[cores].statut === 'occupé' && etatCores[cores].utilisateur === currentUserName) {
          e.target.checked = true;
        }
      }
    });
  });

  document.querySelectorAll('.besoin-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      if (!isSignedIn) {
        alert('Veuillez vous connecter avec Google pour utiliser cette fonctionnalité.');
        e.target.checked = false;
        return;
      }
      const cores = e.target.getAttribute('data-cores');
      const besoinEmailDiv = document.querySelector(`.besoin-email[data-cores="${cores}"]`);
      if (e.target.checked) {
        besoinEmailDiv.classList.remove('hidden');
      } else {
        besoinEmailDiv.classList.add('hidden');
      }
    });
  });

  document.querySelectorAll('.start-btn').forEach(button => {
    button.addEventListener('click', async (e) => {
      const cores = e.target.getAttribute('data-cores');
      const userNameInput = document.querySelector(`.user-input[data-cores="${cores}"] .user-name-input`);
      const userName = userNameInput.value.trim();

      if (!userName) {
        alert('Veuillez entrer votre nom !');
        return;
      }

      await occuperCores(cores, userName);
      document.querySelector(`.user-input[data-cores="${cores}"]`).classList.add('hidden');
    });
  });

  document.querySelectorAll('.besoin-btn').forEach(button => {
    button.addEventListener('click', async (e) => {
      const cores = e.target.getAttribute('data-cores');
      const emailInput = document.querySelector(`.besoin-email[data-cores="${cores}"] .email-input`);
      const email = emailInput.value.trim();

      if (!email) {
        alert('Veuillez entrer votre email !');
        return;
      }

      await enregistrerBesoin(cores, currentUserName, email);
      alert(`Votre besoin pour ${cores} a été enregistré. Vous recevrez un email quand la ressource sera libre.`);
      emailInput.value = '';
      document.querySelector(`.besoin-checkbox[data-cores="${cores}"]`).checked = false;
      document.querySelector(`.besoin-email[data-cores="${cores}"]`).classList.add('hidden');
    });
  });
}

// ========== GOOGLE SHEETS — ÉTAT ==========

// Marque un cores comme occupé dans la feuille Etat
async function occuperCores(cores, userName) {
  const debut = new Date().toISOString();
  const rowIndex = getRowIndex(cores);

  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Etat!A${rowIndex}:D${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[cores, 'occupé', userName, debut]]
      }
    });
    await enregistrerDebutUtilisation(cores, userName, debut);
    await syncEtat();
  } catch (error) {
    console.error('Erreur lors de l\'occupation des cores :', error);
    alert('Erreur lors de la mise à jour. Réessayez.');
  }
}

// Libère un cores et déclenche les emails
async function libererCores(cores) {
  const rowIndex = getRowIndex(cores);
  const debut = etatCores[cores].debut;
  const fin = new Date().toISOString();
  const dureeMinutes = Math.floor((new Date(fin) - new Date(debut)) / (1000 * 60));

  try {
    // Remet à libre dans la feuille Etat
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Etat!A${rowIndex}:D${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[cores, 'libre', '', '']]
      }
    });

    // Enregistre la fin dans la feuille Utilisations
    await enregistrerFinUtilisation(cores, currentUserName, debut, fin, dureeMinutes);
    // Envoie les emails si des gens ont besoin de ce cores
    await envoyerEmailLiberation(cores);
    await syncEtat();

    // Message de confirmation
    alert(`✅ ${cores} libéré ! Un email a été envoyé aux personnes en attente.`);
    
  } catch (error) {
    console.error('Erreur lors de la libération des cores :', error);
    alert('Erreur lors de la libération. Réessayez.');
  }
}

// Retourne le numéro de ligne dans la feuille Etat pour un cores donné
function getRowIndex(cores) {
  const indices = {
    'cores 0-23':  2,
    'cores 24-47': 3,
    'cores 48-71': 4,
    'cores 72-95': 5,
  };
  return indices[cores];
}

// ========== GOOGLE SHEETS — HISTORIQUE ==========
async function enregistrerDebutUtilisation(cores, userName, debut) {
  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Utilisations!A:E',
      valueInputOption: 'RAW',
      resource: {
        values: [[userName, cores, debut, '', '']]
      }
    });
  } catch (error) {
    console.error('Erreur enregistrement début :', error);
  }
}

async function enregistrerFinUtilisation(cores, userName, debut, fin, dureeMinutes) {
  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Utilisations!A:E',
      valueInputOption: 'RAW',
      resource: {
        values: [[userName, cores, debut, fin, dureeMinutes]]
      }
    });
  } catch (error) {
    console.error('Erreur enregistrement fin :', error);
  }
}

async function enregistrerBesoin(cores, userName, email) {
  try {
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Besoins!A:D',
      valueInputOption: 'RAW',
      resource: {
        values: [[userName, cores, email, new Date().toISOString()]]
      }
    });
  } catch (error) {
    console.error('Erreur enregistrement besoin :', error);
    alert('Erreur lors de l\'enregistrement du besoin.');
  }
}

// ========== ENVOI D'EMAILS ==========
async function envoyerEmailLiberation(cores) {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Besoins!A:D'
    });

    const besoins = response.result.values || [];
    const emailsInteresses = besoins
      .filter(row => row[1] === cores)
      .map(row => row[2]);

    if (emailsInteresses.length > 0) {
      const scriptUrl = 'https://script.google.com/macros/s/TON_ID_DE_SCRIPT/exec';
      fetch(scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cores, emails: emailsInteresses })
      });
    }
  } catch (error) {
    console.error('Erreur envoi emails :', error);
  }
}

// ========== RAFRAÎCHISSEMENT DU TOKEN ==========
async function refreshTokenSiNecessaire() {
  const token = gapi.client.getToken();
  if (!token) {
    isSignedIn = false;
    updateAuthStatus(false);
    return false;
  }

  const expiresSoon = (token.expires_at - Date.now()) < 5 * 60 * 1000;
  if (!expiresSoon) return true;

  // Sauvegarde l'état dans sessionStorage avant le refresh
  sessionStorage.setItem('pendingCores', JSON.stringify(etatCores));
  sessionStorage.setItem('currentUserName', currentUserName);

  return new Promise((resolve) => {
    tokenClient.callback = async (response) => {
      if (response.error) {
        console.error('Erreur renouvellement :', response);
        resolve(false);
        return;
      }
      // Restaure le nom sans appel réseau
      currentUserName = sessionStorage.getItem('currentUserName') || '';
      document.getElementById('user-info').textContent = `Connecté en tant que : ${currentUserName}`;
      resolve(true);
    };

    // Utilise use_fedcm_for_prompt pour éviter le popup bloqué
    tokenClient.requestAccessToken({ 
      prompt: '',
      use_fedcm_for_prompt: true  // ← utilise FedCM natif du navigateur, pas de popup
    });
  });
}
