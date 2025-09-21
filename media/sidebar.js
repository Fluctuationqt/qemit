const vscode = acquireVsCodeApi();

const addCredentialForm = document.getElementById('addCredentialForm');
const showAddBtn = document.getElementById('showAddCredentials');
const saveCredentialBtn = document.getElementById('saveCredential');
const brokerHostContainer = document.getElementById('brokerHostContainer');
const deleteBtn = document.getElementById('deleteCredential');

let savedCredentials = [];
const persisted = vscode.getState() || {};
let selectedBrokerHost = persisted.selectedBrokerHost || '';

function renderBrokerHostInput() {
    brokerHostContainer.innerHTML = `
    <label for="brokerHost">Broker Host</label>
    <input id="brokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" />
  `;
}

function populateCredFieldsFrom(host) {
    const cred = savedCredentials.find(c => c.brokerHost === host);
    document.getElementById('username').value = cred?.username || '';
    document.getElementById('password').value = cred?.password || '';
}

function createBrokerDropdown(credentials) {
    const select = document.createElement('select');
    select.id = 'brokerHost';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select Broker --';
    select.appendChild(defaultOption);

    credentials.forEach(({ brokerHost }) => {
        const option = document.createElement('option');
        option.value = brokerHost;
        option.textContent = brokerHost;
        select.appendChild(option);
    });

    if (selectedBrokerHost && credentials.some(c => c.brokerHost === selectedBrokerHost)) {
        select.value = selectedBrokerHost;
        populateCredFieldsFrom(selectedBrokerHost);
    }

    select.addEventListener('change', () => {
        selectedBrokerHost = select.value;
        vscode.setState({ ...(vscode.getState() || {}), selectedBrokerHost });
        if (!selectedBrokerHost) {
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            return;
        }
        populateCredFieldsFrom(selectedBrokerHost);
    });

    return select;
}

function renderBrokerSelectorFrom(creds) {
    if (Array.isArray(creds) && creds.length > 0) {
        brokerHostContainer.innerHTML = '<label for="brokerHost">Broker Host</label>';
        brokerHostContainer.appendChild(createBrokerDropdown(creds));
    } else {
        selectedBrokerHost = '';
        vscode.setState({ ...(vscode.getState() || {}), selectedBrokerHost });
        renderBrokerHostInput();
    }
}

// UI events
showAddBtn.addEventListener('click', () => {
    const isHidden = getComputedStyle(addCredentialForm).display === 'none';
    addCredentialForm.style.display = isHidden ? 'block' : 'none';
});

saveCredentialBtn.addEventListener('click', () => {
    const newUsername = document.getElementById('newUsername').value.trim();
    const newPassword = document.getElementById('newPassword').value;
    const newBrokerHost = document.getElementById('newBrokerHost').value.trim();
    if (!newUsername || !newPassword || !newBrokerHost) {
        return;
    }

    vscode.postMessage({
        command: 'addCredential',
        username: newUsername,
        password: newPassword,
        brokerHost: newBrokerHost
    });

    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newBrokerHost').value = '';
    addCredentialForm.style.display = 'none';
});

deleteBtn.addEventListener('click', () => {
    const select = document.getElementById('brokerHost');
    const selectedHost = select && select.tagName === 'SELECT' ? select.value : '';
    if (!selectedHost) {
        return;
    }
    vscode.postMessage({ command: 'deleteCredential', brokerHost: selectedHost });
});

document.getElementById('publish').addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const brokerHostElem = document.getElementById('brokerHost');
    const brokerHost = brokerHostElem ? brokerHostElem.value : '';
    const topic = document.getElementById('topic').value;
    if (!username || !password || !brokerHost) {
        return;
    }
    vscode.postMessage({ command: 'publish', username, password, brokerHost, topic });
});

// State restoration + message handling
const state = vscode.getState() || {};
if (Array.isArray(state.credentials)) {
    savedCredentials = state.credentials;
    renderBrokerSelectorFrom(savedCredentials);
} else {
    renderBrokerHostInput();
}

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'loadSavedCredentials') {
        savedCredentials = Array.isArray(message.credentials) ? message.credentials : [];
        if (!savedCredentials.find(c => c.brokerHost === selectedBrokerHost)) {
            selectedBrokerHost = '';
        }
        vscode.setState({ credentials: savedCredentials, selectedBrokerHost });
        renderBrokerSelectorFrom(savedCredentials);

        const select = document.getElementById('brokerHost');
        if (select && select.tagName === 'SELECT' && !savedCredentials.find(c => c.brokerHost === select.value)) {
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            select.value = '';
        }
    }
});
