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
		// ... updated HTML below
		return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<style>
			/* Your existing styles here */
			body {
				font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
				background-color: #1e1e1e;
				color: #cccccc;
				padding: 20px;
				margin: 0;
			}
			h3 {
				font-weight: 600;
				color: #007acc;
				margin-bottom: 20px;
			}
			.form-group {
				margin-bottom: 15px;
			}
			label {
				display: block;
				margin-bottom: 5px;
				font-size: 0.9rem;
				color: #a0a0a0;
			}
			input[type="text"],
			input[type="password"],
			select {
				width: 100%;
				padding: 10px 12px;
				border: 1px solid #3c3c3c;
				border-radius: 4px;
				background-color: #252526;
				color: #cccccc;
				font-size: 1rem;
				box-sizing: border-box;
				transition: border-color 0.2s ease;
			}
			input[type="text"]:focus,
			input[type="password"]:focus,
			select:focus {
				outline: none;
				border-color: #007acc;
				background-color: #1e1e1e;
			}
			button {
				width: 100%;
				padding: 12px;
				font-size: 1rem;
				font-weight: 600;
				color: white;
				background-color: #007acc;
				border: none;
				border-radius: 4px;
				cursor: pointer;
				transition: background-color 0.3s ease;
				margin-top: 10px;
			}
			button:hover {
				background-color: #005a9e;
			}
			button:active {
				background-color: #003f6f;
			}
			#addCredentialForm {
				display: none;
				margin-top: 20px;
				border-top: 1px solid #3c3c3c;
				padding-top: 20px;
			}
			</style>
		</head>
		<body>
			<h3>Publish File via AMQP</h3>

			<button id="showAddCredentials">Add Credentials</button>

			<!-- Add Credentials Form -->
			<div id="addCredentialForm">
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

				<button id="saveCredential">Save Credentials</button>
			</div>

			<!-- Main Publish Form -->
			<div id="publishForm" style="margin-top: 20px;">
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

				<div class="form-group">
					<label for="topic">Topic</label>
					<input id="topic" type="text" placeholder="Topic (e.g. my.queue)" value="queue://test" />
				</div>

				<button id="publish">Publish</button>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				const addCredentialForm = document.getElementById('addCredentialForm');
				const showAddBtn = document.getElementById('showAddCredentials');
				const saveCredentialBtn = document.getElementById('saveCredential');
				const brokerHostContainer = document.getElementById('brokerHostContainer');

				let savedCredentials = [];

				showAddBtn.addEventListener('click', () => {
					// Toggle form visibility
					if (addCredentialForm.style.display === 'none') {
						addCredentialForm.style.display = 'block';
					} else {
						addCredentialForm.style.display = 'none';
					}
				});

				saveCredentialBtn.addEventListener('click', () => {
					const newUsername = document.getElementById('newUsername').value.trim();
					const newPassword = document.getElementById('newPassword').value;
					const newBrokerHost = document.getElementById('newBrokerHost').value.trim();

					if (!newUsername || !newPassword || !newBrokerHost) {
						alert('Please fill all fields');
						return;
					}

					vscode.postMessage({
						command: 'addCredential',
						username: newUsername,
						password: newPassword,
						brokerHost: newBrokerHost
					});

					// Clear form and hide
					document.getElementById('newUsername').value = '';
					document.getElementById('newPassword').value = '';
					document.getElementById('newBrokerHost').value = '';
					addCredentialForm.style.display = 'none';
				});

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

					select.addEventListener('change', () => {
						const selectedHost = select.value;
						if (!selectedHost) {
							// Reset username and password if none selected
							document.getElementById('username').value = '';
							document.getElementById('password').value = '';
							return;
						}
						const cred = savedCredentials.find(c => c.brokerHost === selectedHost);
						if (cred) {
							document.getElementById('username').value = cred.username;
							document.getElementById('password').value = cred.password;
						}
					});

					return select;
				}

				// Handle incoming messages from extension
				window.addEventListener('message', event => {
					const message = event.data;
					if (message.command === 'loadSavedCredentials') {
						savedCredentials = message.credentials;

						if (savedCredentials.length) {
							// Replace brokerHost input with dropdown
							const container = brokerHostContainer;
							container.innerHTML = '<label for="brokerHost">Broker Host</label>';
							const select = createBrokerDropdown(savedCredentials);
							container.appendChild(select);
						} else {
							// No saved credentials, keep input field
							brokerHostContainer.innerHTML = \`
								<label for="brokerHost">Broker Host</label>
								<input id="brokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" />
							\`;
						}
					}
				});

				document.getElementById('publish').addEventListener('click', () => {
					const username = document.getElementById('username').value;
					const password = document.getElementById('password').value;
					let brokerHostElem = document.getElementById('brokerHost');
					const brokerHost = brokerHostElem ? brokerHostElem.value : '';
					const topic = document.getElementById('topic').value;

					if (!username || !password || !brokerHost) {
						alert('Please fill username, password, and broker host');
						return;
					}

					vscode.postMessage({
						command: 'publish',
						username,
						password,
						brokerHost,
						topic
					});
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
