import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "qemit" is now active!');

	const disposable = vscode.commands.registerCommand('qemit.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from qemit!');
	});

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('qemitForm', new QEmitSidebarProvider(context))
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}

class QEmitSidebarProvider implements vscode.WebviewViewProvider {
	constructor(private readonly context: vscode.ExtensionContext) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml(webviewView.webview);

		// On load, send saved brokers and selected broker to webview
		this.sendSavedCredentials(webviewView);

		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.command) {
				case 'publish': {
					const { username, password, brokerHost, topic } = message;

					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						vscode.window.showErrorMessage('No active editor with a file open.');
						return;
					}

					const fileContent = editor.document.getText();

					try {
						await sendViaAmqp(username, password, brokerHost, topic, fileContent);
						vscode.window.showInformationMessage(`Published to topic: ${topic}`);
					} catch (err: any) {
						vscode.window.showErrorMessage(`Failed to publish: ${err.message || JSON.stringify(err)}`);
					}
					break;
				}

				case 'addCredential': {
					const { username, password, brokerHost } = message;

					// Load saved credentials list or empty array
					const savedCreds: Array<{ username: string; brokerHost: string }> =
						this.context.globalState.get('savedCredentials', []);

					// Check if brokerHost already exists (to prevent duplicates)
					if (savedCreds.find(c => c.brokerHost === brokerHost)) {
						vscode.window.showWarningMessage(`Broker ${brokerHost} already saved.`);
						break;
					}

					// Add new credential (password stored securely)
					savedCreds.push({ username, brokerHost });
					await this.context.globalState.update('savedCredentials', savedCreds);
					await this.context.secrets.store(`password_${brokerHost}`, password);

					vscode.window.showInformationMessage(`Saved credentials for ${brokerHost}`);

					// Send updated credentials list to webview to update dropdown
					this.sendSavedCredentials(webviewView);

					break;
				}

				case 'deleteCredential': {
					const { brokerHost } = message;
  					if (!brokerHost) { break; } // <— silently ignore when nothing selected

					// Load saved credentials
					const savedCreds: Array<{ username: string; brokerHost: string }> =
						this.context.globalState.get('savedCredentials', []);

					const nextCreds = savedCreds.filter(c => c.brokerHost !== brokerHost);

					if (nextCreds.length === savedCreds.length) {
						vscode.window.showWarningMessage(`No saved credentials found for ${brokerHost}.`);
						break;
					}

					await this.context.globalState.update('savedCredentials', nextCreds);
					try {
						await this.context.secrets.delete(`password_${brokerHost}`);
					} catch {
						// ignore secret deletion errors; proceed
					}
					
					vscode.window.showInformationMessage('Deleted credentials for ' + brokerHost);

					// Refresh the webview dropdown/state
					this.sendSavedCredentials(webviewView);
					break;
				}
			}
		});
	}

	async sendSavedCredentials(webviewView: vscode.WebviewView) {
		const savedCreds: Array<{ username: string; brokerHost: string }> =
			this.context.globalState.get('savedCredentials', []);

		// Retrieve passwords securely
		const credsWithPasswords = await Promise.all(
			savedCreds.map(async (c) => ({
				username: c.username,
				brokerHost: c.brokerHost,
				password: await this.context.secrets.get(`password_${c.brokerHost}`) || ''
			}))
		);

		webviewView.webview.postMessage({
			command: 'loadSavedCredentials',
			credentials: credsWithPasswords
		});
	}

private getHtml(webview: vscode.Webview): string {
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${webview.cspSource} https:;
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root{
        --bg:#1e1e1e;
        --bg-elev:#1b1b1b;
        --text:#cccccc;
        --muted:#a0a0a0;
        --border:#2b2b2b;
        --border-strong:#3c3c3c;
        --accent:#007acc;
      }
      *{box-sizing:border-box}
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: var(--bg);
        color: var(--text);
        padding: 20px;
        margin: 0;
      }
      h3 { font-weight: 600; color: var(--accent); margin: 0 0 16px; }

      /* Card styles for the Add Credentials section */
      .card {
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px;
        box-shadow: 0 1px 0 rgba(0,0,0,.3), 0 10px 24px rgba(0,0,0,.18);
      }
      .card h4 {
        margin: 0 0 12px;
        font-weight: 600;
        color: #d6d6d6;
        letter-spacing:.2px;
      }

      .form-group { margin-bottom: 12px; }
      label { display:block; margin-bottom:6px; font-size:.9rem; color:var(--muted); }
      input[type="text"], input[type="password"], select {
        width:100%; padding:10px 12px; border:1px solid var(--border-strong); border-radius:8px;
        background:#252526; color:var(--text); font-size:1rem; transition:border-color .2s ease;
      }
      input[type="text"]:focus, input[type="password"]:focus, select:focus {
        outline:none; border-color: var(--accent); background:#1e1e1e;
      }

      button {
        width:100%; padding:12px; font-size:1rem; font-weight:600; color:#fff;
        background: var(--accent); border:none; border-radius:8px; cursor:pointer;
        transition:transform .04s ease, background-color .3s ease; margin-top:10px;
      }
      button:hover { background:#005a9e; }
      button:active { transform: translateY(1px); }

      /* Danger variant for delete */
      button.danger { background:#c42b1c; }
      button.danger:hover { background:#a5261a; }
      button.danger:active { background:#7f1d13; }

      /* Divider line shown under the Add Credentials card */
      .section-divider{
        height:1px;
        margin:14px 0 18px;
        background: linear-gradient(90deg, transparent, #3f3f3f, transparent);
        border:0;
      }

      /* Container spacing so things breathe a bit */
      .block { margin-top:18px; }
    </style>
  </head>
  <body>
    <h3>Publish File via AMQP</h3>

    <button id="showAddCredentials" type="button">Add Credentials</button>

    <!-- Add Credentials: hidden by default, styled as card -->
    <div id="addCredentialForm" class="card block" style="display:none;">
      <h4>Add New Credentials</h4>
      <div class="form-group">
        <label for="newUsername">Username</label>
        <input id="newUsername" type="text" placeholder="Username" />
      </div>
      <div class="form-group">
        <label for="newPassword">Password</label>
        <input id="newPassword" type="password" placeholder="Password" />
      </div>
      <div class="form-group">
        <label for="newBrokerHost">Broker Host</label>
        <input id="newBrokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" />
      </div>
      <button id="saveCredential" type="button">Save Credentials</button>
    </div>

    <!-- This subtle divider appears only when the card is visible -->
    <div id="addDivider" class="section-divider" style="display:none;"></div>

    <div id="publishForm" class="block">
      <div class="form-group">
        <label for="username">Username</label>
        <input id="username" type="text" placeholder="Username" />
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" type="password" placeholder="Password" />
      </div>

      <div class="form-group" id="brokerHostContainer">
        <label for="brokerHost">Broker Host</label>
        <input id="brokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" />
      </div>

      <!-- Full-width red delete button -->
      <button id="deleteCredential" class="danger" type="button">Delete Selected</button>

      <div class="form-group block">
        <label for="topic">Topic</label>
        <input id="topic" type="text" placeholder="Topic (e.g. my.queue)" value="queue://test" />
      </div>

      <button id="publish" type="button">Publish</button>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const addCredentialForm = document.getElementById('addCredentialForm');
      const addDivider = document.getElementById('addDivider');
      const showAddBtn = document.getElementById('showAddCredentials');
      const saveCredentialBtn = document.getElementById('saveCredential');
      const brokerHostContainer = document.getElementById('brokerHostContainer');
      const deleteBtn = document.getElementById('deleteCredential');

      let savedCredentials = [];
      const persisted = vscode.getState() || {};
      let selectedBrokerHost = persisted.selectedBrokerHost || '';

      // --- Helpers -----------------------------------------------------------
      function renderBrokerHostInput() {
        brokerHostContainer.innerHTML = \`
          <label for="brokerHost">Broker Host</label>
          <input id="brokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" />
        \`;
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
          vscode.setState({ ...(vscode.getState()||{}), selectedBrokerHost });
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
          vscode.setState({ ...(vscode.getState()||{}), selectedBrokerHost });
          renderBrokerHostInput();
        }
      }

      // --- UI events ---------------------------------------------------------
      showAddBtn.addEventListener('click', () => {
        const isHidden = getComputedStyle(addCredentialForm).display === 'none';
        addCredentialForm.style.display = isHidden ? 'block' : 'none';
        addDivider.style.display = isHidden ? 'block' : 'none';
      });

      saveCredentialBtn.addEventListener('click', () => {
        const newUsername = document.getElementById('newUsername').value.trim();
        const newPassword = document.getElementById('newPassword').value;
        const newBrokerHost = document.getElementById('newBrokerHost').value.trim();

        if (!newUsername || !newPassword || !newBrokerHost) return;

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
        addDivider.style.display = 'none';
      });

      // Always enabled: try to delete; if no selection, silently do nothing
      deleteBtn.addEventListener('click', () => {
        const select = document.getElementById('brokerHost');
        const selectedHost = select && select.tagName === 'SELECT' ? select.value : '';
        if (!selectedHost) return;
        vscode.postMessage({ command: 'deleteCredential', brokerHost: selectedHost });
      });

      document.getElementById('publish').addEventListener('click', () => {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const brokerHostElem = document.getElementById('brokerHost');
        const brokerHost = brokerHostElem ? brokerHostElem.value : '';
        const topic = document.getElementById('topic').value;
        if (!username || !password || !brokerHost) return;
        vscode.postMessage({ command: 'publish', username, password, brokerHost, topic });
      });

      // --- State restoration -------------------------------------------------
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
    </script>
  </body>
  </html>
  `;
}




}


import * as rhea from "rhea";

export async function sendViaAmqp(
  username: string,
  password: string,
  brokerUrl: string,
  topic: string,
  message: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(brokerUrl);

    const isSecure = url.protocol === "amqps:";
    const port = parseInt(url.port) || (isSecure ? 5671 : 5672);

    const container = rhea.create_container();

    // Connection options differ for TLS vs non-TLS
    let connectionOptions: rhea.ConnectionOptions;

    if (isSecure) {
      connectionOptions = {
        transport: "tls",
        host: url.hostname,
        port,
        reconnect: false,
        username,
        password,
      };
    } else {
      connectionOptions = {
        host: url.hostname,
        port,
        reconnect: false,
        //username,
        //password,
      };
    }

    const connection = container.connect(connectionOptions);

    let sender: rhea.Sender;

    connection.on("connection_open", (context) => {
      console.log("[AMQP] Connected");
      sender = context.connection.open_sender(topic);
    });

    connection.on("sendable", (context) => {
      if (context.sender && context.sender.sendable()) {
        try {
          context.sender.send({ body: message });
          console.log("[AMQP] Message sent:", message);
          context.sender.close();
          context.connection.close();
          resolve();
        } catch (err) {
          console.error("[AMQP] Send error:", err);
          reject(err);
        }
      }
    });

    connection.on("connection_close", () => {
      console.log("[AMQP] Connection closed");
    });

    connection.on("connection_error", (context) => {
      console.error("[AMQP] Connection error:", context.connection?.error);
      reject(context.connection?.error || new Error("Unknown connection error"));
    });

    connection.on("disconnected", (context) => {
      console.error("[AMQP] Disconnected:", context.error);
      reject(context.error || new Error("Disconnected from AMQP broker"));
    });

    connection.on("protocol_error", (context) => {
      console.error("[AMQP] Protocol error:", context.connection?.error);
      reject(context.connection?.error || new Error("Protocol error"));
    });
  });
}
