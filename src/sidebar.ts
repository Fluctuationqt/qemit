
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import path from 'node:path';
import { sendViaAmqp } from './amqp';

export default class QEmitSidebarProvider implements vscode.WebviewViewProvider {
	constructor(private readonly context: vscode.ExtensionContext) { }

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
		};

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

		// Build URIs that the webview can load
		const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'sidebar.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'sidebar.css'));

		// Read the HTML template from disk
		const htmlPath = path.join(this.context.extensionPath, 'media', 'sidebar.html');
		let html = fs.readFileSync(htmlPath, 'utf8');

		// Replace placeholders in the template
		html = html
			.replace(/\{\{cspSource\}\}/g, webview.cspSource)
			.replace(/\{\{nonce\}\}/g, nonce)
			.replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
			.replace(/\{\{styleUri\}\}/g, styleUri.toString());

		return html;
	}
}
