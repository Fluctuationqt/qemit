import * as vscode from 'vscode';
import QEmitSidebarProvider from './sidebar';


export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "qemit" is now active!');

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('qemitForm', new QEmitSidebarProvider(context))
	);
}

export function deactivate() { }
