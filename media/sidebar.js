const vscode = acquireVsCodeApi();

// helpers
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
let persisted = vscode.getState?.() || {};

// cache elements
const addForm = $('addCredentialForm');
const toggleAddBtn = $('showAddCredentials');
const deleteBtn = $('deleteCredential');

const brokerSelect = /** @type {HTMLSelectElement} */ ($('brokerHostSelect'));
const brokerInput  = /** @type {HTMLInputElement} */ ($('brokerHostText'));

const publishForm = $('publishForm');
const publishBtn  = /** @type {HTMLButtonElement} */ ($('publish'));

const usernameEl = /** @type {HTMLInputElement} */ ($('username'));
const passwordEl = /** @type {HTMLInputElement} */ ($('password'));
const topicEl    = /** @type {HTMLInputElement} */ ($('topic'));

const newUserEl  = /** @type {HTMLInputElement} */ ($('newUsername'));
const newPassEl  = /** @type {HTMLInputElement} */ ($('newPassword'));
const newHostEl  = /** @type {HTMLInputElement} */ ($('newBrokerHost'));

// state
let credentials = /** @type {{username:string,password:string,brokerHost:string}[]} */ (persisted.credentials || []);
let selectedBrokerHost = persisted.selectedBrokerHost || '';

// util: persist once
function persist(partial) {
  persisted = { ...(persisted || {}), ...partial };
  vscode.setState(persisted);
}

// UI toggles
function show(el)  { el.classList.remove('hidden'); }
function hide(el)  { el.classList.add('hidden');  }

// fill username/password from selected broker
function populateFrom(host) {
  const cred = credentials.find(c => c.brokerHost === host);
  usernameEl.value = cred?.username || '';
  passwordEl.value = cred?.password || '';
}

// render broker UI depending on saved credentials
function renderBrokerUI() {
  if (credentials.length > 0) {
    // show select, hide free-text
    show(brokerSelect);
    hide(brokerInput);

    // (re)build options efficiently
    const frag = document.createDocumentFragment();
    // keep the first placeholder
    brokerSelect.length = 1;
    for (const { brokerHost } of credentials) {
      const opt = document.createElement('option');
      opt.value = brokerHost;
      opt.textContent = brokerHost;
      frag.appendChild(opt);
    }
    brokerSelect.appendChild(frag);

    // restore selection if still valid
    if (selectedBrokerHost && credentials.some(c => c.brokerHost === selectedBrokerHost)) {
      brokerSelect.value = selectedBrokerHost;
      populateFrom(selectedBrokerHost);
    } else {
      brokerSelect.value = '';
      selectedBrokerHost = '';
      populateFrom('');
    }
  } else {
    // no saved creds → free text input
    hide(brokerSelect);
    show(brokerInput);
    selectedBrokerHost = '';
  }
  updatePublishEnabled();
}

// computed: can publish?
function canPublish() {
  const host = credentials.length ? brokerSelect.value : brokerInput.value.trim();
  return Boolean(usernameEl.value && passwordEl.value && host);
}
function updatePublishEnabled() {
  publishBtn.disabled = !canPublish();
}

// ============== Event wiring ==============
toggleAddBtn.addEventListener('click', () => {
  const nowHidden = addForm.classList.toggle('hidden');
  toggleAddBtn.textContent = nowHidden ? 'Add Credentials' : 'Close';
});

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = newUserEl.value.trim();
  const password = newPassEl.value;
  const brokerHost = newHostEl.value.trim();
  if (!username || !password || !brokerHost) return;

  vscode.postMessage({ command: 'addCredential', username, password, brokerHost });

  newUserEl.value = '';
  newPassEl.value = '';
  newHostEl.value = '';
  addForm.classList.add('hidden');
  toggleAddBtn.textContent = 'Add Credentials';
});

deleteBtn.addEventListener('click', () => {
  if (!credentials.length) return;
  const host = brokerSelect.value;
  if (!host) return;
  vscode.postMessage({ command: 'deleteCredential', brokerHost: host });
});

// react to selection change
brokerSelect.addEventListener('change', () => {
  selectedBrokerHost = brokerSelect.value;
  persist({ selectedBrokerHost });
  populateFrom(selectedBrokerHost);
  updatePublishEnabled();
});

// enable/disable Publish live
publishForm.addEventListener('input', updatePublishEnabled);

publishForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const brokerHost = credentials.length ? brokerSelect.value : brokerInput.value.trim();
  if (!usernameEl.value || !passwordEl.value || !brokerHost) return;

  vscode.postMessage({
    command: 'publish',
    username: usernameEl.value,
    password: passwordEl.value,
    brokerHost,
    topic: topicEl.value
  });
});

// Initial render using persisted state
renderBrokerUI();

// ============== Message pump from extension ==============
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.command === 'loadSavedCredentials') {
    credentials = Array.isArray(message.credentials) ? message.credentials : [];
    // reset selection if removed
    if (!credentials.find(c => c.brokerHost === selectedBrokerHost)) {
      selectedBrokerHost = '';
      persist({ selectedBrokerHost });
      usernameEl.value = '';
      passwordEl.value = '';
    }
    // persist the new list once
    persist({ credentials });
    renderBrokerUI();
  }
});
