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

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'publish') {
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
			}
		});
	}

	private getHtml(_webview: vscode.Webview): string {
	return `
	<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<style>
		/* Reset and base */
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

		/* Container */
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
		input[type="password"] {
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
		input[type="password"]:focus {
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
		</style>
	</head>
	<body>
		<h3>Publish File via AMQP</h3>

		<div class="form-group">
		<label for="username">Username</label>
		<input id="username" type="text" placeholder="Username" value="admin" />
		</div>

		<div class="form-group">
		<label for="password">Password</label>
		<input id="password" type="password" placeholder="Password" value="admin" />
		</div>

		<div class="form-group">
		<label for="brokerHost">Broker Host</label>
		<input id="brokerHost" type="text" placeholder="Broker Host (e.g. amqp://localhost:5672)" value="amqp://localhost:5672" />
		</div>

		<div class="form-group">
		<label for="topic">Topic</label>
		<input id="topic" type="text" placeholder="Topic (e.g. my.queue)" value="queue://test" />
		</div>

		<button id="publish">Publish</button>

		<script>
		const vscode = acquireVsCodeApi();

		document.getElementById('publish').addEventListener('click', () => {
			const username = document.getElementById('username').value;
			const password = document.getElementById('password').value;
			const brokerHost = document.getElementById('brokerHost').value;
			const topic = document.getElementById('topic').value;

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
