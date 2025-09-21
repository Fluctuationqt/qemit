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
				reconnect: false
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
